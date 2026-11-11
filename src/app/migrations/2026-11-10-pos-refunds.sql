-- Receipt evidence is independent of legacy/source-only order and return tables.
CREATE TABLE IF NOT EXISTS pos_refund_receipts (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 180),
  refund_id TEXT NOT NULL CHECK(length(refund_id) BETWEEN 1 AND 200),
  original_sale_id TEXT NOT NULL CHECK(length(original_sale_id) BETWEEN 1 AND 200),
  amount_q NUMERIC(10,2) NOT NULL CHECK(amount_q >= 0),
  currency TEXT NOT NULL DEFAULT 'GTQ' CHECK(currency='GTQ'),
  origin TEXT NOT NULL CHECK(origin IN('api','loyverse')),
  scope TEXT NOT NULL DEFAULT 'unknown' CHECK(scope IN('full','partial','unknown')),
  fingerprint TEXT NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  native_evidence_hash TEXT CHECK(native_evidence_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','reconciled')),
  reason TEXT NOT NULL DEFAULT 'awaiting_reconciliation',
  original_transaction_id UUID,
  reversal_transaction_id UUID,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  UNIQUE(business_id,source,refund_id),
  CHECK(refund_id <> original_sale_id),
  CHECK((origin='loyverse')=(native_evidence_hash IS NOT NULL)),
  CHECK(status <> 'reconciled' OR (original_transaction_id IS NOT NULL AND reversal_transaction_id IS NOT NULL AND reconciled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pos_refund_history ON pos_refund_receipts(business_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS pos_refund_pending ON pos_refund_receipts(business_id,last_attempt_at,created_at) WHERE status='pending';
ALTER TABLE pos_refund_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_refund_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_refund_receipts;
CREATE POLICY tenant_isolation ON pos_refund_receipts
  USING(app.is_platform_admin() OR business_id=app.current_tenant())
  WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON pos_refund_receipts FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON pos_refund_receipts TO %I',r);
    END IF;
  END LOOP;
END $$;
