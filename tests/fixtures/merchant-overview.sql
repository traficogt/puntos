-- Minimal disposable schema with production column types/defaults. Deliberately
-- no RLS: the overview must enforce tenant isolation in its own SQL too.
CREATE TEMP TABLE businesses (id uuid PRIMARY KEY,program_json jsonb DEFAULT '{}');
CREATE TEMP TABLE branches (id uuid PRIMARY KEY, business_id uuid NOT NULL);
CREATE TEMP TABLE customers (id uuid PRIMARY KEY, business_id uuid NOT NULL, deleted_at timestamptz);
CREATE TEMP TABLE transactions (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, branch_id uuid,
  customer_id uuid NOT NULL, type text DEFAULT 'PURCHASE',
  amount_q numeric(10,2) NOT NULL DEFAULT 0, points integer NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0, items integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'POSTED', source text NOT NULL DEFAULT 'online',
  original_transaction_id uuid, reversed_transaction_id uuid,
  created_at timestamptz NOT NULL
);
CREATE TEMP TABLE rewards (id uuid PRIMARY KEY, business_id uuid NOT NULL, name text NOT NULL);
CREATE TEMP TABLE redemptions (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, branch_id uuid,
  customer_id uuid NOT NULL, reward_id uuid NOT NULL,
  points_cost integer NOT NULL, status text NOT NULL DEFAULT 'REDEEMED',
  created_at timestamptz NOT NULL, redeemed_at timestamptz
);
