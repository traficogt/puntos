-- Reduce blast radius: prevent runtime role from selecting password hashes directly.
-- Instead, expose a narrow SECURITY DEFINER lookup function.
CREATE SCHEMA IF NOT EXISTS app;

DO $$
BEGIN
  IF to_regclass('staff_login_index') IS NULL THEN
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

  -- Lock down direct reads if the runtime role exists.
  REVOKE ALL ON TABLE staff_login_index FROM PUBLIC;
  REVOKE ALL ON FUNCTION app.staff_login_lookup(TEXT) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loyalty') THEN
    REVOKE ALL ON TABLE staff_login_index FROM loyalty;
    GRANT EXECUTE ON FUNCTION app.staff_login_lookup(TEXT) TO loyalty;
  END IF;
END$$;
