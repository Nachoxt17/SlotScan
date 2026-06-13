-- =====================================================
-- SlotScan — Custom grid migration
-- Lets each zone choose how its slot grid is generated:
--   • SIMPLE  — every row has the same number of columns (uses zones.cols),
--               exactly like before: A1..A10, B1..B10, …
--   • CUSTOM  — each row (letter) has its OWN number of columns, stored as a
--               JSON array in zones.col_counts, e.g. [11, 7, 20]:
--                 A1..A11, B1..B7, C1..C20, …
-- Sub-slots (A1.A, A1.B, …) behave identically in both modes.
--
-- Paste into Supabase: SQL Editor → New query → Run. Safe to re-run.
-- =====================================================

ALTER TABLE zones ADD COLUMN IF NOT EXISTS col_counts jsonb;

-- When present, col_counts must be a JSON array (one integer per row).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zones_col_counts_is_array') THEN
    ALTER TABLE zones ADD CONSTRAINT zones_col_counts_is_array
      CHECK (col_counts IS NULL OR jsonb_typeof(col_counts) = 'array');
  END IF;
END $$;

-- Existing zones keep col_counts = NULL, which the app treats as SIMPLE mode,
-- so nothing changes for current data.
