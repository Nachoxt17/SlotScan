-- =====================================================
-- SlotScan — Supabase schema, RLS, and RPCs
-- Paste this entire file into Supabase: SQL Editor → New query → Run.
-- Safe to re-run: it uses "if not exists" / "or replace" where it can.
-- =====================================================

-- ---------- Tables ----------

create table if not exists businesses (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  shelves_rows    int,
  shelves_cols    int,
  owner_id        uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create table if not exists business_members (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  username        text not null,
  email           text not null,
  role            text not null check (role in ('admin','sub')),
  created_at      timestamptz not null default now(),
  unique (business_id, user_id)
);

create table if not exists business_invites (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  email           text not null,
  role            text not null check (role in ('admin','sub')),
  created_by      uuid not null references auth.users(id) on delete cascade,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (business_id, email)
);

create table if not exists items (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  code            text not null,
  name            text not null,
  slot            text not null,
  type            text not null check (type in ('barcode','qr')),
  created_at      timestamptz not null default now(),
  unique (business_id, code)
);

create index if not exists items_business_idx     on items(business_id);
create index if not exists members_business_idx   on business_members(business_id);
create index if not exists members_user_idx       on business_members(user_id);
create index if not exists invites_email_idx      on business_invites(email) where accepted_at is null;

-- ---------- Helper functions ----------

create or replace function is_member(biz_id uuid) returns boolean
  language sql security definer set search_path = public as $$
  select exists (
    select 1 from business_members
    where business_id = biz_id and user_id = auth.uid()
  );
$$;

create or replace function is_admin(biz_id uuid) returns boolean
  language sql security definer set search_path = public as $$
  select exists (
    select 1 from business_members
    where business_id = biz_id and user_id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- RPCs (atomic operations) ----------

create or replace function create_business(biz_name text, uname text)
  returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  uemail text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into uemail from auth.users where id = auth.uid();
  insert into businesses (name, owner_id)
    values (biz_name, auth.uid())
    returning id into new_id;
  insert into business_members (business_id, user_id, username, email, role)
    values (new_id, auth.uid(), uname, uemail, 'admin');
  return new_id;
end;
$$;

create or replace function accept_invite(invite_id uuid)
  returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  inv record;
  uname text;
  uemail text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into uemail from auth.users where id = auth.uid();
  select * into inv
    from business_invites
    where id = invite_id and lower(email) = lower(uemail) and accepted_at is null;
  if not found then raise exception 'invite not found or already accepted'; end if;
  select coalesce(raw_user_meta_data->>'username', email) into uname
    from auth.users where id = auth.uid();
  insert into business_members (business_id, user_id, username, email, role)
    values (inv.business_id, auth.uid(), uname, uemail, inv.role)
    on conflict (business_id, user_id) do nothing;
  update business_invites set accepted_at = now() where id = invite_id;
  return inv.business_id;
end;
$$;

-- ---------- Enable RLS ----------

alter table businesses          enable row level security;
alter table business_members    enable row level security;
alter table business_invites    enable row level security;
alter table items               enable row level security;

-- Drop any old policies (idempotent re-runs)
drop policy if exists biz_select  on businesses;
drop policy if exists biz_update  on businesses;
drop policy if exists mem_select  on business_members;
drop policy if exists mem_delete  on business_members;
drop policy if exists inv_select  on business_invites;
drop policy if exists inv_insert  on business_invites;
drop policy if exists inv_delete  on business_invites;
drop policy if exists items_select on items;
drop policy if exists items_modify on items;

-- ---------- Policies ----------

-- Businesses: visible to members; admins can update name + shelves
create policy biz_select on businesses for select using (is_member(id));
create policy biz_update on businesses for update using (is_admin(id));

-- Members: visible to any member of same business; admins remove sub-users
create policy mem_select on business_members for select using (is_member(business_id));
create policy mem_delete on business_members for delete using (
  is_admin(business_id) and user_id != auth.uid()
);

-- Invites: visible to admins of biz OR to the invitee (by email); admins manage
create policy inv_select on business_invites for select using (
  is_admin(business_id) or lower(email) = lower(auth.email())
);
create policy inv_insert on business_invites for insert with check (is_admin(business_id));
create policy inv_delete on business_invites for delete using (
  is_admin(business_id) or lower(email) = lower(auth.email())
);

-- Items: all members can read; only admins write
create policy items_select on items for select using (is_member(business_id));
create policy items_modify on items for all
  using (is_admin(business_id))
  with check (is_admin(business_id));

-- ---------- Realtime ----------
-- Enable realtime broadcasting for items so all phones sync instantly.
alter publication supabase_realtime add table items;
