-- Enforce RLS for application role by disabling BYPASSRLS, but skip gracefully if privileges are insufficient.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loyalty') THEN
    BEGIN
      EXECUTE 'ALTER ROLE loyalty NOBYPASSRLS';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping ALTER ROLE loyalty NOBYPASSRLS (insufficient privileges)';
    END;
  END IF;
END$$;
