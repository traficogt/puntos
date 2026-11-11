-- Dedicated disposable fixture; no RLS, so SQL must enforce tenant isolation.
CREATE TEMP TABLE customers (id uuid PRIMARY KEY, business_id uuid NOT NULL, name text, deleted_at timestamptz);
CREATE TEMP TABLE referrals (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, referrer_customer_id uuid NOT NULL,
  referred_customer_id uuid NOT NULL, status text, created_at timestamptz NOT NULL,
  referrer_reward_points integer, referred_reward_points integer,
  referrer_rewarded_at timestamptz, referred_rewarded_at timestamptz
);
CREATE TEMP TABLE transactions (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL,
  amount_q numeric(10,2) NOT NULL DEFAULT 0, visits integer DEFAULT 0, items integer DEFAULT 0,
  type text DEFAULT 'PURCHASE', source text DEFAULT 'online', status text DEFAULT 'POSTED',
  original_transaction_id uuid, reversed_transaction_id uuid, created_at timestamptz NOT NULL
);
