-- RLS policies join webhook_deliveries -> webhook_endpoints via endpoint_id.
-- Add an index to keep tenant filtering fast.
DO $$
BEGIN
  IF to_regclass('webhook_deliveries') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'webhook_deliveries'
      AND indexname = 'idx_webhook_deliveries_endpoint'
  ) THEN
    CREATE INDEX idx_webhook_deliveries_endpoint ON webhook_deliveries(endpoint_id);
  END IF;
END$$;

