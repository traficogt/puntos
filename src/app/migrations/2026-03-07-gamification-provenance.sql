ALTER TABLE customer_achievements
  ADD COLUMN IF NOT EXISTS source_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

ALTER TABLE customer_achievements
  ADD COLUMN IF NOT EXISTS reward_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_achievements_source_tx
  ON customer_achievements(source_transaction_id);

CREATE INDEX IF NOT EXISTS idx_customer_achievements_reward_tx
  ON customer_achievements(reward_transaction_id);

WITH achievement_rewards AS (
  SELECT DISTINCT ON (t.customer_id, t.meta->>'achievement_id')
    t.customer_id,
    (t.meta->>'achievement_id')::uuid AS achievement_id,
    t.id AS reward_transaction_id,
    NULLIF(t.meta->>'source_transaction_id', '')::uuid AS source_transaction_id
  FROM transactions t
  WHERE t.type = 'ACHIEVEMENT'
    AND t.status <> 'REVERSED'
    AND t.meta ? 'achievement_id'
  ORDER BY t.customer_id, t.meta->>'achievement_id', t.created_at DESC
)
UPDATE customer_achievements ca
SET reward_transaction_id = COALESCE(ca.reward_transaction_id, ar.reward_transaction_id),
    source_transaction_id = COALESCE(ca.source_transaction_id, ar.source_transaction_id)
FROM achievement_rewards ar
WHERE ca.customer_id = ar.customer_id
  AND ca.achievement_id = ar.achievement_id;

ALTER TABLE customer_challenges
  ADD COLUMN IF NOT EXISTS last_source_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

ALTER TABLE customer_challenges
  ADD COLUMN IF NOT EXISTS last_reward_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

ALTER TABLE customer_challenges
  ADD COLUMN IF NOT EXISTS completion_history JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_customer_challenges_source_tx
  ON customer_challenges(last_source_transaction_id);

CREATE INDEX IF NOT EXISTS idx_customer_challenges_reward_tx
  ON customer_challenges(last_reward_transaction_id);

WITH challenge_rewards AS (
  SELECT DISTINCT ON (t.customer_id, t.meta->>'challenge_id')
    t.customer_id,
    (t.meta->>'challenge_id')::uuid AS challenge_id,
    t.id AS reward_transaction_id,
    NULLIF(t.meta->>'source_transaction_id', '')::uuid AS source_transaction_id,
    t.created_at
  FROM transactions t
  WHERE t.type = 'CHALLENGE'
    AND t.status <> 'REVERSED'
    AND t.meta ? 'challenge_id'
  ORDER BY t.customer_id, t.meta->>'challenge_id', t.created_at DESC
)
UPDATE customer_challenges cc
SET last_reward_transaction_id = COALESCE(cc.last_reward_transaction_id, cr.reward_transaction_id),
    last_source_transaction_id = COALESCE(cc.last_source_transaction_id, cr.source_transaction_id),
    completion_history = CASE
      WHEN jsonb_array_length(COALESCE(cc.completion_history, '[]'::jsonb)) > 0 THEN cc.completion_history
      WHEN cc.times_completed > 0 THEN jsonb_build_array(jsonb_build_object(
        'source_transaction_id', cr.source_transaction_id,
        'reward_transaction_id', cr.reward_transaction_id,
        'completed_at', COALESCE(cc.completed_at, cr.created_at)
      ))
      ELSE '[]'::jsonb
    END
FROM challenge_rewards cr
WHERE cc.customer_id = cr.customer_id
  AND cc.challenge_id = cr.challenge_id;
