-- Event time is independent of ledger ingestion time and cannot rewrite history.
-- Legacy rows deliberately keep NULL evidence; reports label their fallback.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS purchase_occurred_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS purchase_time_source TEXT;
ALTER TABLE transactions ADD CONSTRAINT transactions_purchase_time_evidence CHECK (
  (purchase_occurred_at IS NULL AND (purchase_time_source IS NULL OR purchase_time_source='server_recorded')) OR
  (purchase_occurred_at IS NOT NULL AND isfinite(purchase_occurred_at) AND purchase_time_source IS NOT NULL AND purchase_time_source IN('pos_receipt','order_receipt','client_reported'))
);
CREATE INDEX IF NOT EXISTS transactions_purchase_event_window
  ON transactions(business_id,customer_id,(COALESCE(purchase_occurred_at,created_at)));

CREATE OR REPLACE FUNCTION app.protect_purchase_event_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.created_at,NEW.purchase_occurred_at,NEW.purchase_time_source)
    IS DISTINCT FROM ROW(OLD.created_at,OLD.purchase_occurred_at,OLD.purchase_time_source) THEN
    RAISE EXCEPTION 'Transaction receipt time and purchase time evidence are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_purchase_event_time BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION app.protect_purchase_event_time();

-- Coverage is limited to receipts observed by these ingestion paths; this is not
-- a count of every sale in an external POS. Keep no customer contact data here.
CREATE TABLE pos_measurement_receipts (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 180),
  sale_id TEXT NOT NULL CHECK(length(sale_id) BETWEEN 1 AND 200),
  occurred_at TIMESTAMPTZ CHECK(occurred_at IS NULL OR isfinite(occurred_at)),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN('matched','unmatched','rejected')),
  PRIMARY KEY(business_id,source,sale_id)
);
CREATE INDEX pos_measurement_receipt_window ON pos_measurement_receipts(business_id,(COALESCE(occurred_at,first_seen_at)),status);
ALTER TABLE pos_measurement_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_measurement_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_measurement_receipts
  USING(app.is_platform_admin() OR business_id=app.current_tenant())
  WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON pos_measurement_receipts FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON pos_measurement_receipts FROM %I',role_name);
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON pos_measurement_receipts TO %I',role_name);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.protect_pos_measurement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (ROW(NEW.business_id,NEW.source,NEW.sale_id,NEW.occurred_at,NEW.first_seen_at)
    IS DISTINCT FROM ROW(OLD.business_id,OLD.source,OLD.sale_id,OLD.occurred_at,OLD.first_seen_at)
    OR OLD.status='matched' AND NEW.status<>'matched'
    OR OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS NOT NULL AND OLD.transaction_id<>NEW.transaction_id) THEN
    RAISE EXCEPTION 'Original receipt evidence and successful matches are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.transaction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND business_id=NEW.business_id) THEN
    RAISE EXCEPTION 'Receipt transaction must belong to the same business' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_pos_measurement_receipt BEFORE INSERT OR UPDATE ON pos_measurement_receipts
  FOR EACH ROW EXECUTE FUNCTION app.protect_pos_measurement_receipt();

-- Trigger functions are invoked by PostgreSQL, not callable application APIs.
REVOKE ALL ON FUNCTION app.protect_purchase_event_time(),app.protect_pos_measurement_receipt() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION app.protect_purchase_event_time(),app.protect_pos_measurement_receipt() FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
