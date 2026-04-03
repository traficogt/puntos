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
  ON internal_magic_links (token_hash, expires_at);
