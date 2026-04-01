CREATE TABLE IF NOT EXISTS ledger_balance_corrections (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  resolved_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  source_run_id UUID REFERENCES ledger_reconciliation_runs(id) ON DELETE SET NULL,
  source_finding_id UUID REFERENCES ledger_reconciliation_findings(id) ON DELETE SET NULL,
  requested_stored_points INT NOT NULL DEFAULT 0,
  requested_expected_points INT NOT NULL DEFAULT 0,
  requested_stored_pending_points INT NOT NULL DEFAULT 0,
  requested_expected_pending_points INT NOT NULL DEFAULT 0,
  requested_stored_lifetime_points INT NOT NULL DEFAULT 0,
  requested_expected_lifetime_points INT NOT NULL DEFAULT 0,
  resolution_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ledger_balance_corrections_business_created
  ON ledger_balance_corrections(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_balance_corrections_customer_created
  ON ledger_balance_corrections(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_balance_corrections_pending
  ON ledger_balance_corrections(business_id, status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ledger_balance_corrections_status_check'
  ) THEN
    ALTER TABLE ledger_balance_corrections
      ADD CONSTRAINT ledger_balance_corrections_status_check
      CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED'));
  END IF;
END $$;
