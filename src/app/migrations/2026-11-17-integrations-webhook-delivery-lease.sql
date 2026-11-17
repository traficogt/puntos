-- Outbound webhook deliveries claimed by a worker that crashed or was replaced
-- during a deploy stayed in SENDING forever. A claim is now a lease: a worker
-- stamps claimed_at and a fresh claim_token, SENDING rows whose lease expired
-- are claimed again with a new token, and a worker completes a delivery only
-- while it still holds that token.
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS claim_token UUID;

-- Rows already in SENDING start their lease now, so a delivery still in flight
-- on a worker from the previous release is not immediately sent a second time.
UPDATE webhook_deliveries SET claimed_at = now() WHERE status = 'SENDING' AND claimed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sending_claimed
  ON webhook_deliveries (claimed_at) WHERE status = 'SENDING';
