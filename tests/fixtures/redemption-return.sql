-- Disposable session-local tables, with production column types. No RLS: the
-- report must still enforce business and customer isolation in its own SQL.
CREATE TEMP TABLE businesses (id uuid PRIMARY KEY, program_json jsonb DEFAULT '{}');
CREATE TEMP TABLE branches (id uuid PRIMARY KEY, business_id uuid NOT NULL);
CREATE TEMP TABLE customers (id uuid PRIMARY KEY, business_id uuid NOT NULL, deleted_at timestamptz);
CREATE TEMP TABLE rewards (id uuid PRIMARY KEY, business_id uuid NOT NULL);
CREATE TEMP TABLE redemptions (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, branch_id uuid,
  customer_id uuid NOT NULL, reward_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'REDEEMED', created_at timestamptz NOT NULL,
  redeemed_at timestamptz
);
CREATE TEMP TABLE transactions (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, branch_id uuid,
  customer_id uuid NOT NULL, type text DEFAULT 'PURCHASE',
  amount_q numeric(10,2) NOT NULL DEFAULT 0, points integer NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0, items integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'POSTED', source text NOT NULL DEFAULT 'online',
  original_transaction_id uuid, reversed_transaction_id uuid,
  created_at timestamptz NOT NULL, meta jsonb DEFAULT '{}'
);
CREATE TEMP TABLE service_redemption_restorations (business_id uuid NOT NULL, redemption_id uuid NOT NULL);
CREATE TEMP TABLE pos_checkout_intents (business_id uuid NOT NULL, redemption_id uuid, status text NOT NULL, recorded_at timestamptz);
CREATE TEMP TABLE redemption_pos_records (business_id uuid NOT NULL, redemption_id uuid NOT NULL, returned_quantity numeric(18,6) DEFAULT 0);
