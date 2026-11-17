-- Reconciliation runs, findings and correction requests hold customer ids and
-- balances. Tenants see only their own rows; rows without business_id
-- (platform-wide operator runs) are visible to platform administrators only.
-- Foreign-key checks bypass RLS, so tenant corrections may still reference runs.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_reconciliation_runs', 'ledger_reconciliation_findings', 'ledger_balance_corrections'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant())',
      t
    );
  END LOOP;
END $$;
