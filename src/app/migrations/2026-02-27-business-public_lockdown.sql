-- Follow-up: lock down business_public AFTER it exists.
-- The original business-public-lockdown migration sorts before business-public.sql (because '-' < '.'),
-- so it can no-op on fresh databases. This migration re-applies the intended final privileges.
DO $$
DECLARE
  r text;
BEGIN
  IF to_regclass('business_public') IS NULL THEN
    RAISE NOTICE 'business_public not found; skipping lockdown';
    RETURN;
  END IF;

  REVOKE ALL ON TABLE business_public FROM PUBLIC;

  -- Known/common runtime roles (grant SELECT only)
  FOREACH r IN ARRAY ARRAY['loyalty', 'puntos_app', 'loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE business_public FROM %I', r);
      EXECUTE format('GRANT SELECT ON TABLE business_public TO %I', r);
    END IF;
  END LOOP;
END$$;

