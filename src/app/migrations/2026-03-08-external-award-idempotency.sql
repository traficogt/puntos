CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_external_event_id
ON transactions(business_id, (meta->>'external_event_id'))
WHERE source = 'external' AND meta ? 'external_event_id';
