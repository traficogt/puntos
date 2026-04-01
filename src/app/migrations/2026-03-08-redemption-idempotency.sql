ALTER TABLE redemptions
  ADD COLUMN IF NOT EXISTS request_id UUID;

ALTER TABLE redemptions
  ADD COLUMN IF NOT EXISTS balance_after INT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_redemptions_business_request_id
ON redemptions(business_id, request_id)
WHERE request_id IS NOT NULL;
