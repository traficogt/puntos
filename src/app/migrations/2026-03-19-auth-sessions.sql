-- Opaque browser sessions backed by the database.
CREATE SCHEMA IF NOT EXISTS app;

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS actor_id UUID,
  ADD COLUMN IF NOT EXISTS actor_email TEXT,
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS impersonated_by TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS idle_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidation_reason TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_actor_id ON auth_sessions(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_actor_email ON auth_sessions(actor_type, actor_email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_business ON auth_sessions(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(invalidated_at, absolute_expires_at, idle_expires_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_sessions_actor_type_check'
      AND conrelid = 'auth_sessions'::regclass
  ) THEN
    ALTER TABLE auth_sessions
      ADD CONSTRAINT auth_sessions_actor_type_check
      CHECK (actor_type IN ('STAFF', 'CUSTOMER', 'SUPER'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_sessions_expiry_check'
      AND conrelid = 'auth_sessions'::regclass
  ) THEN
    ALTER TABLE auth_sessions
      ADD CONSTRAINT auth_sessions_expiry_check
      CHECK (idle_expires_at <= absolute_expires_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_sessions_actor_identity_check'
      AND conrelid = 'auth_sessions'::regclass
  ) THEN
    ALTER TABLE auth_sessions
      ADD CONSTRAINT auth_sessions_actor_identity_check
      CHECK (
        (actor_type = 'SUPER' AND actor_email IS NOT NULL AND actor_id IS NULL AND business_id IS NULL)
        OR (actor_type IN ('STAFF', 'CUSTOMER') AND actor_id IS NOT NULL AND business_id IS NOT NULL)
      );
  END IF;
END$$;

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

REVOKE ALL ON TABLE auth_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_session_lookup(TEXT) FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty', 'puntos_app', 'loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE auth_sessions FROM %I', r);
      EXECUTE format('GRANT INSERT, UPDATE ON TABLE auth_sessions TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.auth_session_lookup(TEXT) TO %I', r);
    END IF;
  END LOOP;
END$$;
