DO $$
DECLARE is_super BOOLEAN;
BEGIN
  SELECT rolsuper INTO is_super FROM pg_roles WHERE rolname = CURRENT_USER;
  IF is_super THEN
    -- Only attempt if role exists and is not the boot superuser
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loyalty') THEN
      BEGIN
        EXECUTE 'ALTER ROLE loyalty NOSUPERUSER';
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'Skipping ALTER ROLE loyalty NOSUPERUSER (insufficient privileges)';
      END;
    END IF;
  END IF;
END$$;
