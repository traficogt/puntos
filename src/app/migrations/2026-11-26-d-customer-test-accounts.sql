-- Test-account marker for customers ("cuenta de prueba"). Design of record:
-- docs/product/2026-11-23-owner-progress.md (counting rules; note of 2026-11-26).
--
-- Owners and PF staff create customer accounts with their own phones during pilots
-- and demos. Until now those accounts were indistinguishable from real customers, so
-- they counted in "Tu progreso", activation insights, trial activation facts, the plan
-- soft-cap usage and the basic report. The flag lets the owner (or the platform owner)
-- mark such an account; every counting surface excludes marked accounts while the
-- directory, the ledger and the audit trail keep them, and their points are never
-- altered.
--
-- Additive and backward-compatible: every existing customer keeps is_test=false, the
-- column has a default so installed native apps and older servers keep inserting
-- customers unchanged, and RLS plus the runtime grants on `customers` already cover
-- the new column (table-level policy and privileges; no new table, no new grant).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

-- Marked accounts are rare; the partial index keeps "how many test accounts does this
-- business have" and the super console count cheap without widening the hot index.
CREATE INDEX IF NOT EXISTS customers_test_accounts
  ON customers(business_id) WHERE is_test;
