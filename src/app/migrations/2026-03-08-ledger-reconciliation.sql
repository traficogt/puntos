CREATE TABLE IF NOT EXISTS ledger_reconciliation_runs (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'RUNNING',
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  checked_customers INT NOT NULL DEFAULT 0,
  mismatched_customers INT NOT NULL DEFAULT 0,
  repaired_customers INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ledger_reconciliation_runs_completed
  ON ledger_reconciliation_runs(completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_reconciliation_runs_business
  ON ledger_reconciliation_runs(business_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS ledger_reconciliation_findings (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES ledger_reconciliation_runs(id) ON DELETE CASCADE,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stored_points INT NOT NULL DEFAULT 0,
  expected_points INT NOT NULL DEFAULT 0,
  stored_pending_points INT NOT NULL DEFAULT 0,
  expected_pending_points INT NOT NULL DEFAULT 0,
  stored_lifetime_points INT NOT NULL DEFAULT 0,
  expected_lifetime_points INT NOT NULL DEFAULT 0,
  repaired BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_reconciliation_findings_run
  ON ledger_reconciliation_findings(run_id);

CREATE INDEX IF NOT EXISTS idx_ledger_reconciliation_findings_business
  ON ledger_reconciliation_findings(business_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ledger_reconciliation_runs_scope_check'
  ) THEN
    ALTER TABLE ledger_reconciliation_runs
      ADD CONSTRAINT ledger_reconciliation_runs_scope_check
      CHECK (scope IN ('all', 'business', 'customer'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ledger_reconciliation_runs_status_check'
  ) THEN
    ALTER TABLE ledger_reconciliation_runs
      ADD CONSTRAINT ledger_reconciliation_runs_status_check
      CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_balances_pending_points_nonnegative'
  ) THEN
    ALTER TABLE customer_balances
      ADD CONSTRAINT customer_balances_pending_points_nonnegative
      CHECK (pending_points >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_balances_lifetime_points_nonnegative'
  ) THEN
    ALTER TABLE customer_balances
      ADD CONSTRAINT customer_balances_lifetime_points_nonnegative
      CHECK (lifetime_points >= 0);
  END IF;
END $$;
