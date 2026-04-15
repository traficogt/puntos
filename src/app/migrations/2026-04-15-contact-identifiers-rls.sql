-- Add tenant RLS for contact identifiers to match the orders security baseline.
DO $$
BEGIN
  IF to_regclass('contact_identifiers') IS NOT NULL THEN
    ALTER TABLE contact_identifiers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contact_identifiers FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON contact_identifiers;
    CREATE POLICY tenant_isolation ON contact_identifiers
      USING (app.is_platform_admin() OR business_id = app.current_tenant())
      WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());
  END IF;
END$$;
