-- Relax RLS to allow superuser / background operations when app.current_tenant() IS NULL.
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
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app.current_tenant() IS NULL OR business_id = app.current_tenant())', t);
  END LOOP;
END$$;
