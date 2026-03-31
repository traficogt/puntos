CREATE TABLE IF NOT EXISTS ledger_balance_adjustments (
  id UUID PRIMARY KEY,
  correction_id UUID UNIQUE REFERENCES ledger_balance_corrections(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  delta_points INT NOT NULL DEFAULT 0,
  delta_pending_points INT NOT NULL DEFAULT 0,
  delta_lifetime_points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_balance_adjustments_business_created
  ON ledger_balance_adjustments(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_balance_adjustments_customer_created
  ON ledger_balance_adjustments(customer_id, created_at DESC);
