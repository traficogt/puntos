-- Add tenant RLS for orders after public ingestion started setting app.current_tenant().
DO $$
BEGIN
  IF to_regclass('orders') IS NOT NULL THEN
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE orders FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON orders;
    CREATE POLICY tenant_isolation ON orders
      USING (app.is_platform_admin() OR business_id = app.current_tenant())
      WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());
  END IF;
END$$;
