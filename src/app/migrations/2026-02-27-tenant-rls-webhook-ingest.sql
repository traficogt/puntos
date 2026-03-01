-- Allow authenticated webhook ingestion to read/update unmapped events (business_id IS NULL)
-- without enabling broad platform_admin mode.
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.is_webhook_ingest() RETURNS boolean AS $$
  SELECT current_setting('app.webhook_ingest', true) = 'true';
$$ LANGUAGE sql STABLE;

-- Replace payment_webhook_events policy to allow ingest-mode access for NULL-tenant rows.
DO $$
BEGIN
  IF to_regclass('payment_webhook_events') IS NOT NULL THEN
    ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payment_webhook_events FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation ON payment_webhook_events;
    CREATE POLICY tenant_isolation ON payment_webhook_events
      USING (
        app.is_platform_admin()
        OR business_id = app.current_tenant()
        OR (business_id IS NULL AND app.is_webhook_ingest())
      )
      WITH CHECK (
        app.is_platform_admin()
        OR business_id IS NULL
        OR business_id = app.current_tenant()
      );
  END IF;
END$$;
