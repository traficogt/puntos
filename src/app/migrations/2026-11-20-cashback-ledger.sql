-- Cashback program: a per-customer, spendable store-credit balance (in Q) with a
-- full transaction ledger, kept separate from the points ledger.
--
-- Additive and backward-compatible: this migration only CREATEs new tables and
-- indexes; it changes no existing table or column, and nothing reads these tables
-- unless a business runs a CASHBACK program_type. A website deploy that includes
-- it therefore requires no app update and does not affect points/discount/stamp
-- programs. Mirrors the gift-card ledger (gift_card_transactions) and the strict
-- tenant-isolation RLS policy (business_id = app.current_tenant()).

CREATE TABLE IF NOT EXISTS cashback_accounts (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  balance_q NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_earned_q NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_spent_q NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cashback_accounts_balance_nonneg CHECK (balance_q >= 0)
);
CREATE INDEX IF NOT EXISTS idx_cashback_accounts_business ON cashback_accounts (business_id);

CREATE TABLE IF NOT EXISTS cashback_transactions (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  request_id UUID NOT NULL,
  tx_type TEXT NOT NULL,                      -- EARN | SPEND | ADJUST
  amount_q NUMERIC(12,2) NOT NULL,            -- positive = credited, negative = spent
  balance_after_q NUMERIC(12,2) NOT NULL,
  source_transaction_id UUID,                 -- the order/award transaction that earned it
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotency: one ledger row per (business, request_id). An EARN replays on the
-- source transaction id; a SPEND replays on the staff-supplied request id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashback_tx_request ON cashback_transactions (business_id, request_id);
CREATE INDEX IF NOT EXISTS idx_cashback_tx_customer ON cashback_transactions (customer_id, created_at DESC);

-- Enable the same tenant-isolation RLS the other per-business tables use, but only
-- when the app RLS helpers exist (they are defined by the tenant-RLS migrations).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'current_tenant'
  ) THEN
    EXECUTE 'ALTER TABLE cashback_accounts ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE cashback_transactions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON cashback_accounts';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON cashback_transactions';
    EXECUTE 'CREATE POLICY tenant_isolation ON cashback_accounts USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant())';
    EXECUTE 'CREATE POLICY tenant_isolation ON cashback_transactions USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant())';
  END IF;
END $$;
