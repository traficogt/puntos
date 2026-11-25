-- Provider-agnostic subscription billing (design section 3.3). Wave 1 writes only
-- the manual provider (super-console activation) and trial_notifications; the
-- Recurrente/Stripe adapters of later waves fill the other rows. These tables are
-- deliberately separate from billing_events, which is a per-tenant usage ledger.
CREATE TABLE IF NOT EXISTS billing_customers (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('recurrente','stripe','manual')),
  provider_customer_id TEXT NOT NULL,
  email TEXT NOT NULL,
  tax_id TEXT,
  tax_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, provider),
  UNIQUE (provider, provider_customer_id)
);
CREATE TABLE IF NOT EXISTS billing_checkouts (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('recurrente','stripe','manual')),
  provider_checkout_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9),
  currency TEXT NOT NULL CHECK (currency IN ('GTQ','USD')),
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','expired','abandoned')),
  checkout_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_checkout_id)
);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('recurrente','stripe','manual')),
  provider_subscription_id TEXT NOT NULL,
  checkout_id UUID REFERENCES billing_checkouts(id) ON DELETE SET NULL,
  plan TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  currency TEXT NOT NULL CHECK (currency IN ('GTQ','USD')),
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('active','past_due','paused','canceled')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_one_active
  ON billing_subscriptions(business_id) WHERE status IN ('active','past_due','paused');

-- The owner reads its own rows; only platform code (super console, webhooks) writes.
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_customers','billing_checkouts','billing_subscriptions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin())', t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r AND oid <> (SELECT relowner FROM pg_class WHERE oid = to_regclass(t))) THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', t, r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', t, r);
   END IF;
  END LOOP;
 END LOOP;
END $$;

-- Webhook events arrive before a tenant is known and are deduplicated by provider id.
CREATE TABLE IF NOT EXISTS billing_provider_events (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('recurrente','stripe','manual')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  live_mode BOOLEAN NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  error TEXT,
  UNIQUE (provider, provider_event_id)
);
ALTER TABLE billing_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_provider_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_auth_only ON billing_provider_events;
CREATE POLICY platform_auth_only ON billing_provider_events
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
REVOKE ALL ON billing_provider_events FROM PUBLIC;

-- Each trial reminder is sent at most once per business; the row is written only
-- after the mail relay accepted the message, so a failed send retries the next day.
CREATE TABLE IF NOT EXISTS trial_notifications (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('welcome','day10','day13','locked','purge7','purged')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  destination TEXT NOT NULL,
  provider_id TEXT,
  PRIMARY KEY (business_id, kind)
);
ALTER TABLE trial_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON trial_notifications;
CREATE POLICY tenant_isolation ON trial_notifications
  USING (app.is_platform_admin() OR business_id = app.current_tenant())
  WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());
REVOKE ALL ON trial_notifications FROM PUBLIC;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON billing_provider_events TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, DELETE ON trial_notifications TO %I', r);
    END IF;
  END LOOP;
END $$;
