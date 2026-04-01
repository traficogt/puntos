CREATE OR REPLACE FUNCTION app.auth_session_touch(p_id UUID, p_idle_expires_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $fn$
  UPDATE auth_sessions
     SET last_seen_at = now(),
         idle_expires_at = p_idle_expires_at
   WHERE id = p_id
     AND invalidated_at IS NULL
$fn$;

CREATE OR REPLACE FUNCTION app.auth_session_invalidate_by_id(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $fn$
  UPDATE auth_sessions
     SET invalidated_at = now(),
         invalidation_reason = COALESCE(p_reason, invalidation_reason)
   WHERE id = p_id
     AND invalidated_at IS NULL
$fn$;

CREATE OR REPLACE FUNCTION app.auth_session_invalidate_by_actor(
  p_actor_type TEXT,
  p_actor_id UUID,
  p_actor_email TEXT,
  p_reason TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $fn$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE auth_sessions
     SET invalidated_at = now(),
         invalidation_reason = COALESCE(p_reason, invalidation_reason)
   WHERE actor_type = p_actor_type
     AND invalidated_at IS NULL
     AND (
       (p_actor_id IS NOT NULL AND actor_id = p_actor_id)
       OR (p_actor_email IS NOT NULL AND actor_email = p_actor_email)
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

CREATE OR REPLACE FUNCTION app.auth_session_mark_reauthenticated(p_id UUID, p_mfa_verified BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $fn$
BEGIN
  IF p_mfa_verified THEN
    UPDATE auth_sessions
       SET reauth_verified_at = now(),
           mfa_verified_at = now()
     WHERE id = p_id
       AND invalidated_at IS NULL;
  ELSE
    UPDATE auth_sessions
       SET reauth_verified_at = now()
     WHERE id = p_id
       AND invalidated_at IS NULL;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION app.auth_session_touch(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_session_invalidate_by_id(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_session_invalidate_by_actor(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_session_mark_reauthenticated(UUID, BOOLEAN) FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty', 'puntos_app', 'loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.auth_session_touch(UUID, TIMESTAMPTZ) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.auth_session_invalidate_by_id(UUID, TEXT) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.auth_session_invalidate_by_actor(TEXT, UUID, TEXT, TEXT) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.auth_session_mark_reauthenticated(UUID, BOOLEAN) TO %I', r);
    END IF;
  END LOOP;
END$$;
