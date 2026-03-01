-- Ensure runtime roles can execute app.* helper functions by granting USAGE on the app schema.
-- This is required for staff_login_lookup (schema-qualified call).
CREATE SCHEMA IF NOT EXISTS app;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty', 'puntos_app', 'loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA app TO %I', r);
    END IF;
  END LOOP;
END$$;

