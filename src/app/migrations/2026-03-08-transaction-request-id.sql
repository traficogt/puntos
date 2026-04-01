ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_business_request_id
ON transactions(business_id, request_id)
WHERE request_id IS NOT NULL;
