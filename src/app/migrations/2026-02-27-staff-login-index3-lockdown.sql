-- Follow-up: ensure staff_login_index lockdown/grants cover additional runtime role names.
-- This is intentionally idempotent and safe to re-run.
CREATE SCHEMA IF NOT EXISTS app;

DO $$
DECLARE
  r text;
BEGIN
  IF to_regclass('staff_login_index') IS NULL THEN
    RAISE NOTICE 'staff_login_index not found; skipping lockdown';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION app.staff_login_lookup(p_email TEXT)
  RETURNS TABLE (
    id UUID,
    business_id UUID,
    branch_id UUID,
    name TEXT,
    email TEXT,
    role TEXT,
    password_hash TEXT,
    active BOOLEAN
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, app
  AS $fn$
    SELECT
      staff_user_id AS id,
      business_id,
      branch_id,
      name,
      email,
      role,
      password_hash,
      active
    FROM staff_login_index
    WHERE email = lower(p_email)
    LIMIT 1
  $fn$;

  REVOKE ALL ON TABLE staff_login_index FROM PUBLIC;
  REVOKE ALL ON FUNCTION app.staff_login_lookup(TEXT) FROM PUBLIC;

  -- Known/common runtime roles (execute-only on the definer function; no table reads).
  FOREACH r IN ARRAY ARRAY['loyalty', 'puntos_app', 'loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE staff_login_index FROM %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.staff_login_lookup(TEXT) TO %I', r);
    END IF;
  END LOOP;
END$$;

