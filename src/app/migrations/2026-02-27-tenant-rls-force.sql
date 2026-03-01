-- Enforce RLS even for table owners on tenant-scoped tables.
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
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  -- businesses remains without FORCE to allow super/global read access when tenant is NULL.
END$$;
