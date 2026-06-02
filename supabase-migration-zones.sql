-- =====================================================
-- SlotScan — Zones migration
-- Adds multiple shelf groups (e.g. "Shelf 1", "Fridge", "Pantry")
-- per business, each with its own rows × cols × sub-slots.
-- Existing items get auto-moved to a default "Main" zone.
-- Safe to re-run.
-- =====================================================

-- 1. Zones table
CREATE TABLE IF NOT EXISTS zones (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  rows         int  not null check (rows  > 0 and rows  <= 26),
  cols         int  not null check (cols  > 0 and cols  <= 99),
  subslots     int  not null default 0 check (subslots >= 0 and subslots <= 10),
  position     int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (business_id, name)
);

CREATE INDEX IF NOT EXISTS zones_business_idx ON zones(business_id);

-- 2. items get a zone_id (nullable for now; backfilled below; not enforced NOT NULL
--    so legacy rows from the very first migration phase don't break re-runs)
ALTER TABLE items ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES zones(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS items_zone_idx ON items(zone_id);

-- 3. Backfill — every business that already had a shelf layout gets a "Main" zone,
--    and its existing items move into that zone.
DO $$
DECLARE
  biz RECORD;
  new_zone_id uuid;
BEGIN
  FOR biz IN
    SELECT id, shelves_rows, shelves_cols, COALESCE(shelves_subslots, 0) AS subs
      FROM businesses
     WHERE shelves_rows IS NOT NULL
  LOOP
    SELECT id INTO new_zone_id
      FROM zones
     WHERE business_id = biz.id
     ORDER BY created_at
     LIMIT 1;

    IF new_zone_id IS NULL THEN
      INSERT INTO zones (business_id, name, rows, cols, subslots, position)
        VALUES (biz.id, 'Main', biz.shelves_rows, biz.shelves_cols, biz.subs, 0)
        RETURNING id INTO new_zone_id;
    END IF;

    UPDATE items
       SET zone_id = new_zone_id
     WHERE business_id = biz.id
       AND zone_id IS NULL;
  END LOOP;
END $$;

-- 4. RLS
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zones_select ON zones;
DROP POLICY IF EXISTS zones_modify ON zones;
CREATE POLICY zones_select ON zones FOR SELECT USING (is_member(business_id));
CREATE POLICY zones_modify ON zones FOR ALL
  USING (is_admin(business_id))
  WITH CHECK (is_admin(business_id));

-- 5. Realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE zones;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
