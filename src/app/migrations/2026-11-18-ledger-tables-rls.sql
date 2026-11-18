-- Enable tenant RLS on the ledger tables that were created after the canonical
-- tenant-RLS migration and never had row-level security applied. The runtime
-- role is NOBYPASSRLS, so without this these financial tables rely entirely on
-- every application query carrying an explicit business_id filter — there is no
-- DB backstop, unlike the 40+ tables the canonical migration covers.
--
-- Policy matches the canonical tenant_isolation shape:
--   platform admin (worker/super) sees all; a tenant sees only its own rows.
-- Access paths verified compatible:
--   * ledger reconciliation worker runs under withDbClientContext({platformAdmin:true})
--   * tenant-facing reads/writes set app.current_tenant and filter business_id
-- app.is_platform_admin() / app.current_tenant() are defined by the canonical
-- 2026-02-27 migration, which sorts (and applies) before this one.

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'ledger_balance_corrections',
    'ledger_reconciliation_runs',
    'ledger_reconciliation_findings'
  ]) LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname AS polname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p.polname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant())',
      t
    );
  END LOOP;
END$$;
