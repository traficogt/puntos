ALTER TABLE gift_card_transactions
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_card_tx_business_request_id
ON gift_card_transactions(business_id, request_id)
WHERE request_id IS NOT NULL;
