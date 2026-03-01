-- Background jobs table already exists; this adds billing/usage events.
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'count',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_business_created
  ON billing_events (business_id, created_at DESC);

-- Simple view to roll up usage (can be used for billing reports)
CREATE OR REPLACE VIEW billing_usage_daily AS
SELECT
  business_id,
  event_type,
  unit,
  date_trunc('day', created_at) AS day,
  SUM(amount) AS total
FROM billing_events
GROUP BY business_id, event_type, unit, date_trunc('day', created_at);
