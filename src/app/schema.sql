-- PuntosFieles schema (PostgreSQL)
-- Safe to run multiple times (IF NOT EXISTS patterns where possible)

-- Required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  category TEXT,
  plan TEXT NOT NULL DEFAULT 'EMPRENDEDOR',
  program_type TEXT NOT NULL DEFAULT 'SPEND',
  program_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_branding_json JSONB NOT NULL DEFAULT '{"branding_mode":"endorsed_brand","powered_by_visible":true}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS customer_branding_json JSONB NOT NULL DEFAULT '{"branding_mode":"endorsed_brand","powered_by_visible":true}'::jsonb;

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);

CREATE TABLE IF NOT EXISTS staff_users (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'CASHIER',
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS can_manage_gift_cards BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_staff_business ON staff_users(business_id);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  birthday DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_visit_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  UNIQUE (business_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  session_token_hash TEXT NOT NULL UNIQUE,
  actor_type TEXT NOT NULL,
  actor_id UUID,
  actor_email TEXT,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  impersonated_by TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  reauth_verified_at TIMESTAMPTZ,
  mfa_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (actor_type IN ('STAFF', 'CUSTOMER', 'SUPER')),
  CHECK (idle_expires_at <= absolute_expires_at),
  CHECK (
    (actor_type = 'SUPER' AND actor_email IS NOT NULL AND actor_id IS NULL AND business_id IS NULL)
    OR (actor_type IN ('STAFF', 'CUSTOMER') AND actor_id IS NOT NULL AND business_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_actor_id ON auth_sessions(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_actor_email ON auth_sessions(actor_type, actor_email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_business ON auth_sessions(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(invalidated_at, absolute_expires_at, idle_expires_at);

CREATE TABLE IF NOT EXISTS customer_balances (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  points INT NOT NULL DEFAULT 0,
  pending_points INT NOT NULL DEFAULT 0,
  lifetime_points INT NOT NULL DEFAULT 0,
  tier TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rewards (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  points_cost INT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  stock INT,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rewards_business ON rewards(business_id);

CREATE TABLE IF NOT EXISTS reward_branches (
  reward_id UUID NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reward_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_reward_branches_branch ON reward_branches(branch_id);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  type TEXT DEFAULT 'PURCHASE',
  amount_q NUMERIC(10,2) NOT NULL DEFAULT 0,
  points INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'POSTED',
  available_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  original_transaction_id UUID,
  reversed_transaction_id UUID,
  request_id UUID,
  reversal_reason TEXT,
  source TEXT NOT NULL DEFAULT 'online',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Backward-compatible columns used by analytics/gamification extensions.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS visits INT NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS items INT NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'POSTED';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_transaction_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversed_transaction_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE customer_balances ADD COLUMN IF NOT EXISTS pending_points INT NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday DATE;
CREATE INDEX IF NOT EXISTS idx_txn_business ON transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_txn_customer ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_txn_status_available ON transactions(status, available_at);
CREATE INDEX IF NOT EXISTS idx_txn_expiration ON transactions(status, expired_at, created_at);
-- Hard idempotency guard: only one reversal can point to the same original transaction.
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_unique_reversal_per_original
ON transactions(original_transaction_id)
WHERE original_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_business_request_id
ON transactions(business_id, request_id)
WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_external_event_id
ON transactions(business_id, (meta->>'external_event_id'))
WHERE source = 'external' AND meta ? 'external_event_id';

CREATE TABLE IF NOT EXISTS redemptions (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  reward_id UUID NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  request_id UUID,
  code TEXT UNIQUE NOT NULL,
  points_cost INT NOT NULL,
  balance_after INT,
  status TEXT NOT NULL DEFAULT 'REDEEMED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at TIMESTAMPTZ
);
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS balance_after INT;
CREATE INDEX IF NOT EXISTS idx_red_business ON redemptions(business_id);
CREATE INDEX IF NOT EXISTS idx_red_customer ON redemptions(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_redemptions_business_request_id
ON redemptions(business_id, request_id)
WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS verify_codes (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE verify_codes ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE verify_codes ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ;
ALTER TABLE verify_codes ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_verify_business_phone ON verify_codes(business_id, phone);

CREATE TABLE IF NOT EXISTS qr_tokens (
  jti TEXT PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_logs (
  id UUID PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  provider_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_business ON message_logs(business_id);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_business ON webhook_endpoints(business_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_id UUID,
  action TEXT NOT NULL,
  ip TEXT,
  ua TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_business ON audit_logs(business_id);

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  route TEXT,
  method TEXT,
  ip TEXT,
  actor_type TEXT,
  actor_id UUID,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_business ON security_events(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lifecycle_events (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_date DATE NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id, event_type, event_date)
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_business_date ON lifecycle_events(business_id, event_date);

CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_run_after ON background_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_jobs_business_created ON background_jobs(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT,
  business_slug TEXT,
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  customer_id UUID,
  customer_phone TEXT,
  amount_q NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  reason TEXT,
  error TEXT,
  linked_transaction_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_business_status ON payment_webhook_events(business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  code TEXT UNIQUE NOT NULL,
  qr_token TEXT UNIQUE NOT NULL,
  issued_to_name TEXT,
  issued_to_phone TEXT,
  initial_amount_q NUMERIC(10,2) NOT NULL,
  balance_q NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_cards_business ON gift_cards(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id UUID PRIMARY KEY,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  request_id UUID,
  tx_type TEXT NOT NULL,
  amount_q NUMERIC(10,2) NOT NULL,
  balance_after_q NUMERIC(10,2) NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE gift_card_transactions ADD COLUMN IF NOT EXISTS request_id UUID;
CREATE INDEX IF NOT EXISTS idx_gift_card_tx_business ON gift_card_transactions(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_card_tx_card ON gift_card_transactions(gift_card_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_card_tx_business_request_id
ON gift_card_transactions(business_id, request_id)
WHERE request_id IS NOT NULL;

-- Platform-level settings (super admin)
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_action_tokens (
  id UUID PRIMARY KEY,
  request_id UUID,
  actor_type TEXT NOT NULL,
  actor_id UUID,
  actor_email TEXT,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  consumed_meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (actor_type IN ('STAFF', 'SUPER'))
);
CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_actor
  ON auth_action_tokens(actor_type, actor_id, actor_email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_request
  ON auth_action_tokens(request_id, purpose);
CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_expiry
  ON auth_action_tokens(used_at, expires_at);

CREATE TABLE IF NOT EXISTS internal_magic_links (
  id UUID PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'customer')),
  actor_id UUID NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('staff', 'admin-dashboard', 'customer-wallet')),
  usage_mode TEXT NOT NULL CHECK (usage_mode IN ('single_use', 'reusable_window')),
  purpose TEXT NOT NULL CHECK (purpose = 'internal_test_access'),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_count INTEGER NOT NULL DEFAULT 0,
  used_ip TEXT,
  used_ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_internal_magic_links_token_hash_expires_at
  ON internal_magic_links(token_hash, expires_at);

ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc TEXT;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS mfa_pending_created_at TIMESTAMPTZ;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS mfa_confirmed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS super_admin_auth_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true,
  email TEXT,
  password_hash TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  mfa_secret_enc TEXT,
  mfa_pending_secret_enc TEXT,
  mfa_pending_created_at TIMESTAMPTZ,
  mfa_confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (singleton = true)
);

-- Trigger to update businesses.updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_businesses_updated_at ON businesses;
CREATE TRIGGER trg_businesses_updated_at
BEFORE UPDATE ON businesses
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
