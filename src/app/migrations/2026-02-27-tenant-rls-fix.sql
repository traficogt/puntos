-- Ensure schema exists and recreate helper + policies after previous failure.
CREATE SCHEMA IF NOT EXISTS app;

DROP FUNCTION IF EXISTS app.current_tenant();
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'staff_users',
    'customers',
    'branches',
    'rewards',
    'loyalty_tiers',
    'background_jobs',
    'webhook_endpoints',
    'billing_events',
    'payment_webhook_events',
    'message_logs'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app.current_tenant() IS NULL OR business_id = app.current_tenant())', t);
  END LOOP;
END$$;

-- Businesses: allow NULL tenant to see all (super) or match id.
DROP POLICY IF EXISTS tenant_isolation_businesses ON businesses;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_businesses ON businesses USING (app.current_tenant() IS NULL OR id = app.current_tenant());
