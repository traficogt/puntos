-- webhook_deliveries lacks business_id; disable RLS there to avoid policy errors.
ALTER TABLE webhook_deliveries DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries;
