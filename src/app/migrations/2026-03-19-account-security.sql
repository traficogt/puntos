ALTER TABLE message_logs
  ALTER COLUMN business_id DROP NOT NULL;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS reauth_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS app.auth_session_lookup(TEXT);

CREATE OR REPLACE FUNCTION app.auth_session_lookup(p_token_hash TEXT)
RETURNS TABLE (
  id UUID,
  actor_type TEXT,
  actor_id UUID,
  actor_email TEXT,
  business_id UUID,
  role TEXT,
  branch_id UUID,
  impersonated_by TEXT,
  meta JSONB,
  reauth_verified_at TIMESTAMPTZ,
  mfa_verified_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  idle_expires_at TIMESTAMPTZ,
  absolute_expires_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $fn$
  SELECT
    s.id,
    s.actor_type,
    s.actor_id,
    s.actor_email,
    s.business_id,
    s.role,
    s.branch_id,
    s.impersonated_by,
    s.meta,
    s.reauth_verified_at,
    s.mfa_verified_at,
    s.last_seen_at,
    s.idle_expires_at,
    s.absolute_expires_at,
    s.invalidated_at,
    s.invalidation_reason,
    s.created_at
  FROM auth_sessions s
  WHERE s.session_token_hash = p_token_hash
  LIMIT 1
$fn$;

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

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS mfa_pending_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_confirmed_at TIMESTAMPTZ;

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

INSERT INTO super_admin_auth_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;
