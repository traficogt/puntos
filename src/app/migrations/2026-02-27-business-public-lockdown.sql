-- Lock down business_public so it can be read (for join flows) but not modified by runtime roles.
-- Writes should only occur via the sync trigger from businesses.
DO $$
BEGIN
  IF to_regclass('business_public') IS NULL THEN
    RAISE NOTICE 'business_public not found; skipping lockdown';
    RETURN;
  END IF;

  REVOKE ALL ON TABLE business_public FROM PUBLIC;

  -- Common runtime roles (repo defaults / common deployments)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loyalty') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE business_public FROM loyalty;
    GRANT SELECT ON TABLE business_public TO loyalty;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'puntos_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE business_public FROM puntos_app;
    GRANT SELECT ON TABLE business_public TO puntos_app;
  END IF;
END$$;

