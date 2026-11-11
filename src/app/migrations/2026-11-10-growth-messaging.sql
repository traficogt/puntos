-- Consent is never inferred from loyalty enrollment. No existing customer is opted in.
CREATE TABLE IF NOT EXISTS customer_marketing_preferences (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,customer_id),
  FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS marketing_unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  business_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(business_id,customer_id) REFERENCES customer_marketing_preferences(business_id,customer_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS marketing_unsubscribe_customer ON marketing_unsubscribe_tokens(business_id,customer_id);
CREATE TABLE IF NOT EXISTS growth_message_requests (
  business_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,campaign_id,request_id),
  FOREIGN KEY(business_id,campaign_id) REFERENCES growth_campaigns(business_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS growth_message_outbox (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','accepted','failed','uncertain','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  UNIQUE(business_id,campaign_id,customer_id),
  FOREIGN KEY(business_id,campaign_id,customer_id) REFERENCES growth_campaign_members(business_id,campaign_id,customer_id) ON DELETE CASCADE,
  FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS growth_message_pending ON growth_message_outbox(business_id,next_attempt_at) WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS growth_message_frequency ON growth_message_outbox(business_id,customer_id,last_attempt_at);
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['customer_marketing_preferences','marketing_unsubscribe_tokens','growth_message_requests','growth_message_outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant())',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO %I',t,r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
