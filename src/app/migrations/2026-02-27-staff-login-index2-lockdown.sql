-- Follow-up hardening for staff_login_index.
-- This exists because the original lockdown migration sorted before the index creation migration.
-- Safe to run multiple times.
CREATE SCHEMA IF NOT EXISTS app;

DO $$
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

  -- Grant to common runtime roles if present.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loyalty') THEN
    REVOKE ALL ON TABLE staff_login_index FROM loyalty;
    GRANT EXECUTE ON FUNCTION app.staff_login_lookup(TEXT) TO loyalty;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'puntos_app') THEN
    REVOKE ALL ON TABLE staff_login_index FROM puntos_app;
    GRANT EXECUTE ON FUNCTION app.staff_login_lookup(TEXT) TO puntos_app;
  END IF;
END$$;

