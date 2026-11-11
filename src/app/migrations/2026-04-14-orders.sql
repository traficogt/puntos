CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_q NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal_q NUMERIC(10,2),
  discount_q NUMERIC(10,2),
  tax_q NUMERIC(10,2),
  currency TEXT NOT NULL DEFAULT 'GTQ',
  occurred_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'api',
  line_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  points_awarded INT NOT NULL DEFAULT 0,
  transaction_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_business_customer_created
  ON orders (business_id, customer_id, created_at DESC);
