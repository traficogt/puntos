ALTER TABLE orders
  ADD CONSTRAINT orders_id_business_customer_external_unique
  UNIQUE (id, business_id, customer_id, external_order_id);

CREATE TABLE IF NOT EXISTS order_returns (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id UUID NOT NULL,
  external_return_id TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  reason TEXT,
  occurred_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  reversal_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  points_effect INT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, business_id, customer_id, external_order_id)
    REFERENCES orders (id, business_id, customer_id, external_order_id)
    ON DELETE CASCADE,
  UNIQUE (business_id, external_return_id),
  UNIQUE (order_id)
);
