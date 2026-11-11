-- Gross monthly commitments survive refund/deletion. Settings remain opt-in in program_json.lifecycle.
CREATE TABLE IF NOT EXISTS lifecycle_automation_budgets (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule TEXT NOT NULL CHECK(rule IN ('birthday','winback')),
  month DATE NOT NULL CHECK(extract(day FROM month)=1),
  points_committed INTEGER NOT NULL DEFAULT 0 CHECK(points_committed BETWEEN 0 AND 2000000),
  awards INTEGER NOT NULL DEFAULT 0 CHECK(awards>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,rule,month)
);
CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_events_tenant_customer_id ON lifecycle_events(business_id,customer_id,id);
CREATE TABLE IF NOT EXISTS lifecycle_message_outbox (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  event_id UUID NOT NULL UNIQUE,
  rule TEXT NOT NULL CHECK(rule IN ('birthday','winback')),
  points INTEGER NOT NULL CHECK(points BETWEEN 0 AND 10000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','accepted','failed','uncertain','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  claim_token UUID,
  lease_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  provider TEXT,
  provider_reference TEXT,
  message_log_id UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE CASCADE,
  FOREIGN KEY(business_id,customer_id,event_id) REFERENCES lifecycle_events(business_id,customer_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lifecycle_message_pending ON lifecycle_message_outbox(business_id,next_attempt_at) WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS lifecycle_message_frequency ON lifecycle_message_outbox(business_id,customer_id,last_attempt_at);
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['lifecycle_automation_budgets','lifecycle_message_outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant())',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO %I',t,r); END IF;
    END LOOP;
  END LOOP;
END $$;
