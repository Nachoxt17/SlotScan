# SlotScan — Backups & data recovery

SlotScan stores all its data in your Supabase Postgres database. This guide
covers three layers of protection, from the easiest (built into the app) to the
most complete (a full database dump). Use at least two of them.

---

## 1. In-app backup & restore (built in)

Available to the **Platform Owner** in the app: open the **Owner** tab →
**Data backup & restore**.

### Make a backup

1. Sign in with your platform-owner account (see "Becoming the platform owner"
   in the README).
2. Open the **Owner** tab.
3. Click **⬇ Download backup (JSON)**.

You get a file like `slotscan-backup-2026-06-12-14-30-05.json` containing every
**business, zone, member, invite and item**. Store it somewhere safe — a cloud
drive, a password manager's file vault, etc. Do this on a regular schedule
(e.g. weekly, and before any big change).

### Restore from a backup

1. **Owner** tab → **⬆ Restore from file…** → choose your `.json` backup.
2. Confirm the prompt.

Restore is an **upsert keyed by row ID**: rows that still exist are updated,
rows that were deleted are re-created, and nothing is duplicated. It's the quick
way to undo an accidental deletion or recover after a bad edit.

> **What it does NOT include:** the Supabase **auth users** themselves (emails /
> passwords). Those are managed by Supabase Auth and are covered by Supabase's
> own backups (layer 2). The in-app backup restores the *business data* that
> references those users. If a user was permanently deleted from Auth, restoring
> a membership that points at them will be skipped by the database.

The exact same snapshot can also be produced/consumed from SQL:

```sql
select admin_export();              -- returns the JSON document
select admin_restore('<paste json>'::jsonb);
```

(Both require you to be a platform owner; they are defined in
`supabase-migration-platform.sql`.)

---

## 2. Supabase automatic backups (recommended, zero effort)

Supabase backs up the **whole** database (including auth users) for you.

- **Supabase Dashboard → Database → Backups**
  - **Free / Pro plans:** daily backups (retention depends on plan).
  - **Pro and above:** you can enable **Point-in-Time Recovery (PITR)** to
    restore to any second within the retention window.
- To restore, use the **Restore** button next to a backup in that screen.

This is your safety net for "the whole project broke" situations. Check that it
is enabled for your project.

---

## 3. Full database dump from your computer (most portable)

A dump is a complete, portable copy you control. Great for archiving off-site or
migrating between Supabase projects.

### Option A — Supabase CLI (easiest)

```bash
# one-time
npm install -g supabase
supabase login

# dump (data + schema) of your linked project
supabase db dump --file slotscan-full-backup.sql
```

### Option B — pg_dump directly

Get the connection string from **Supabase → Project Settings → Database →
Connection string (URI)**, then:

```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.YOUR-PROJECT.supabase.co:5432/postgres" \
  --no-owner --no-privileges -f slotscan-full-backup.sql
```

### Restore a dump

```bash
psql "postgresql://postgres:[PASSWORD]@db.YOUR-PROJECT.supabase.co:5432/postgres" \
  -f slotscan-full-backup.sql
```

---

## Recommended routine

| Frequency | Action |
|---|---|
| Always on | Supabase automatic backups / PITR (layer 2) |
| Weekly | In-app JSON backup (layer 1) → cloud drive |
| Monthly / before migrations | Full `supabase db dump` (layer 3) → off-site |

A backup you've never tried to restore isn't a backup yet — do a test restore
into a throwaway Supabase project once, so you know the process works.
