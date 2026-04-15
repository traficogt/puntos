DO $$
BEGIN
  IF to_regclass('order_returns') IS NOT NULL THEN
    ALTER TABLE order_returns ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_returns FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON order_returns;
    CREATE POLICY tenant_isolation ON order_returns
      USING (app.is_platform_admin() OR business_id = app.current_tenant())
      WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());
  END IF;
END$$;
