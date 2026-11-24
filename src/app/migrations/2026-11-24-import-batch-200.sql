-- Customer import batches of up to 200 rows (src/app/services/scale-limits.js): one
-- request commits at most one 200-row chunk, and the background import job commits one
-- migration batch per 200-row chunk. The column CHECKs created with the table on
-- 2026-11-10 (row_count BETWEEN 1 AND 100, imported_count and skipped_count BETWEEN 0
-- AND 100) encoded the former 100-row bound and rejected the first 150-row commit in
-- the live suite.
--
-- Safe: widening a CHECK keeps every existing row valid, no column or table changes,
-- nothing reads these counts differently, installed native apps never import, and the
-- 50-entry cap on customer_import_jobs.batch_ids still holds (5,000 / 200 = 25).
-- Idempotent: the old auto-named constraints are dropped by definition (any CHECK that
-- caps one of the three counts at 100), and the new named ones are re-created.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'customer_migration_batches'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '\((row_count|imported_count|skipped_count) <= 100\)'
  LOOP
    EXECUTE format('ALTER TABLE customer_migration_batches DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE customer_migration_batches
  DROP CONSTRAINT IF EXISTS customer_migration_batches_row_count_max200,
  DROP CONSTRAINT IF EXISTS customer_migration_batches_imported_count_max200,
  DROP CONSTRAINT IF EXISTS customer_migration_batches_skipped_count_max200;
ALTER TABLE customer_migration_batches
  ADD CONSTRAINT customer_migration_batches_row_count_max200
    CHECK (row_count BETWEEN 1 AND 200),
  ADD CONSTRAINT customer_migration_batches_imported_count_max200
    CHECK (imported_count BETWEEN 0 AND 200),
  ADD CONSTRAINT customer_migration_batches_skipped_count_max200
    CHECK (skipped_count BETWEEN 0 AND 200);
