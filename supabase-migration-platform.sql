-- =====================================================
-- SlotScan — Platform Owner + Backup migration
--
-- Adds a PLATFORM OWNER (super-admin) role that sits ABOVE the per-business
-- admins, plus server-side helpers for the owner dashboard and for backups.
--
-- A user is a platform owner if their email is listed in platform_admins.
-- This is enforced in the DATABASE (RLS + SECURITY DEFINER functions), so it
-- cannot be bypassed by editing the front-end.
--
-- Paste into Supabase: SQL Editor → New query → Run. Safe to re-run.
-- Run AFTER supabase-schema.sql, supabase-migration-zones.sql and
-- supabase-migration-custom-grid.sql.
-- =====================================================

-- ---------- Who is a platform owner ----------

create table if not exists platform_admins (
  email       text primary key,
  created_at  timestamptz not null default now()
);

-- >>> CHANGE THIS to your own login email (and add more rows for co-owners). <<<
-- It can be seeded before that account even signs up.
insert into platform_admins (email)
  values (lower('ignacioceaglio@gmail.com'))
  on conflict (email) do nothing;

-- True when the *current* logged-in user is a platform owner.
create or replace function is_platform_admin() returns boolean
  language sql security definer set search_path = public, auth as $$
  select exists (
    select 1 from platform_admins
    where email = lower(coalesce(auth.email(), ''))
  );
$$;

-- ---------- Cross-business access for platform owners ----------
-- These are *additional* permissive policies. Postgres OR-combines permissive
-- policies, so normal members keep their existing access and platform owners
-- additionally get full access to every business's rows.

drop policy if exists biz_platform_all   on businesses;
drop policy if exists mem_platform_all    on business_members;
drop policy if exists inv_platform_all    on business_invites;
drop policy if exists items_platform_all  on items;
drop policy if exists zones_platform_all  on zones;

create policy biz_platform_all   on businesses        for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy mem_platform_all   on business_members  for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy inv_platform_all   on business_invites  for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy items_platform_all on items             for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy zones_platform_all on zones             for all
  using (is_platform_admin()) with check (is_platform_admin());

-- platform_admins table is itself only visible/editable to platform owners.
alter table platform_admins enable row level security;
drop policy if exists padmin_all on platform_admins;
create policy padmin_all on platform_admins for all
  using (is_platform_admin()) with check (is_platform_admin());

-- ---------- Owner dashboard RPCs ----------

-- Every business with aggregate counts + owner email (auth.users is otherwise
-- not readable from the client, so this must be a SECURITY DEFINER function).
create or replace function admin_list_businesses()
returns table (
  id uuid, name text, owner_id uuid, owner_email text,
  member_count bigint, admin_count bigint, sub_count bigint,
  item_count bigint, zone_count bigint, created_at timestamptz
)
language sql security definer set search_path = public, auth as $$
  select b.id, b.name, b.owner_id,
         (select u.email from auth.users u where u.id = b.owner_id),
         (select count(*) from business_members m where m.business_id = b.id),
         (select count(*) from business_members m where m.business_id = b.id and m.role = 'admin'),
         (select count(*) from business_members m where m.business_id = b.id and m.role = 'sub'),
         (select count(*) from items i where i.business_id = b.id),
         (select count(*) from zones z where z.business_id = b.id),
         b.created_at
    from businesses b
   where is_platform_admin()         -- non-owners get zero rows
   order by b.created_at desc;
$$;

-- Platform-wide totals for the dashboard header.
create or replace function admin_platform_stats()
returns json language sql security definer set search_path = public, auth as $$
  select case when is_platform_admin() then json_build_object(
    'businesses',      (select count(*) from businesses),
    'users',           (select count(*) from auth.users),
    'members',         (select count(*) from business_members),
    'admins',          (select count(*) from business_members where role = 'admin'),
    'subusers',        (select count(*) from business_members where role = 'sub'),
    'items',           (select count(*) from items),
    'zones',           (select count(*) from zones),
    'pending_invites', (select count(*) from business_invites where accepted_at is null)
  ) else null end;
$$;

-- ---------- Backup / restore RPCs ----------

-- Full snapshot of all business data as a single JSON document.
create or replace function admin_export()
returns jsonb language sql security definer set search_path = public, auth as $$
  select case when is_platform_admin() then jsonb_build_object(
    'slotscan_backup', true,
    'version',         1,
    'exported_at',     now(),
    'businesses',       coalesce((select jsonb_agg(to_jsonb(b)) from businesses b), '[]'::jsonb),
    'zones',            coalesce((select jsonb_agg(to_jsonb(z)) from zones z), '[]'::jsonb),
    'business_members', coalesce((select jsonb_agg(to_jsonb(m)) from business_members m), '[]'::jsonb),
    'business_invites', coalesce((select jsonb_agg(to_jsonb(v)) from business_invites v), '[]'::jsonb),
    'items',            coalesce((select jsonb_agg(to_jsonb(i)) from items i), '[]'::jsonb)
  ) else null end;
$$;

-- Restore from a snapshot produced by admin_export(). Upserts by primary key,
-- so it recovers deleted/changed rows without duplicating existing ones.
-- (Auth users themselves are backed up separately by Supabase; this restores
--  the business DATA that references them.)
create or replace function admin_restore(data jsonb)
returns json language plpgsql security definer set search_path = public, auth as $$
declare
  n_biz int := 0; n_zone int := 0; n_mem int := 0; n_inv int := 0; n_item int := 0;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if data is null or coalesce((data->>'slotscan_backup')::boolean, false) is not true then
    raise exception 'invalid backup payload (missing slotscan_backup flag)';
  end if;

  insert into businesses (id, name, shelves_rows, shelves_cols, owner_id, created_at)
  select (e->>'id')::uuid, e->>'name',
         nullif(e->>'shelves_rows','')::int, nullif(e->>'shelves_cols','')::int,
         (e->>'owner_id')::uuid, coalesce((e->>'created_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(data->'businesses', '[]'::jsonb)) e
  on conflict (id) do update set name = excluded.name;
  get diagnostics n_biz = row_count;

  insert into zones (id, business_id, name, rows, cols, subslots, position, col_counts, created_at)
  select (e->>'id')::uuid, (e->>'business_id')::uuid, e->>'name',
         (e->>'rows')::int, (e->>'cols')::int, coalesce((e->>'subslots')::int, 0),
         coalesce((e->>'position')::int, 0),
         case when (e ? 'col_counts') and jsonb_typeof(e->'col_counts') = 'array' then e->'col_counts' else null end,
         coalesce((e->>'created_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(data->'zones', '[]'::jsonb)) e
  on conflict (id) do update set name = excluded.name, rows = excluded.rows,
         cols = excluded.cols, subslots = excluded.subslots,
         position = excluded.position, col_counts = excluded.col_counts;
  get diagnostics n_zone = row_count;

  insert into business_members (id, business_id, user_id, username, email, role, created_at)
  select (e->>'id')::uuid, (e->>'business_id')::uuid, (e->>'user_id')::uuid,
         e->>'username', e->>'email', e->>'role',
         coalesce((e->>'created_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(data->'business_members', '[]'::jsonb)) e
  on conflict (id) do update set role = excluded.role, username = excluded.username;
  get diagnostics n_mem = row_count;

  insert into business_invites (id, business_id, email, role, created_by, accepted_at, created_at)
  select (e->>'id')::uuid, (e->>'business_id')::uuid, e->>'email', e->>'role',
         (e->>'created_by')::uuid, nullif(e->>'accepted_at','')::timestamptz,
         coalesce((e->>'created_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(data->'business_invites', '[]'::jsonb)) e
  on conflict (id) do nothing;
  get diagnostics n_inv = row_count;

  insert into items (id, business_id, zone_id, code, name, slot, type, created_at)
  select (e->>'id')::uuid, (e->>'business_id')::uuid, nullif(e->>'zone_id','')::uuid,
         e->>'code', e->>'name', e->>'slot', e->>'type',
         coalesce((e->>'created_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(data->'items', '[]'::jsonb)) e
  on conflict (id) do update set name = excluded.name, slot = excluded.slot,
         zone_id = excluded.zone_id, code = excluded.code, type = excluded.type;
  get diagnostics n_item = row_count;

  return json_build_object('businesses', n_biz, 'zones', n_zone,
    'members', n_mem, 'invites', n_inv, 'items', n_item);
end;
$$;
