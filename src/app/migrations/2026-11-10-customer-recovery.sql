-- Recovery stores a manual work list without copying customer contact fields.
-- The original snapshot size survives customer removal; live results do not.
CREATE TABLE IF NOT EXISTS recovery_runs (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  inactive_days INTEGER NOT NULL CHECK (inactive_days IN (30,60,90)),
  requested_limit INTEGER NOT NULL CHECK (requested_limit BETWEEN 1 AND 200),
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count BETWEEN 0 AND 200),
  created_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id,request_id),
  UNIQUE (business_id,id)
);
CREATE INDEX IF NOT EXISTS recovery_runs_business_created
  ON recovery_runs(business_id,created_at DESC,id DESC);

-- Composite keys prevent inserting a customer's ID under another tenant even
-- when using a privileged connection that bypasses row-level policies.
CREATE UNIQUE INDEX IF NOT EXISTS customers_recovery_business_id
  ON customers(business_id,id);
CREATE TABLE IF NOT EXISTS recovery_members (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  last_purchase_at TIMESTAMPTZ NOT NULL,
  recorded_sales_q NUMERIC NOT NULL,
  purchases BIGINT NOT NULL CHECK (purchases > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','skipped')),
  contacted_at TIMESTAMPTZ,
  updated_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  PRIMARY KEY (business_id,run_id,customer_id),
  FOREIGN KEY (business_id,run_id) REFERENCES recovery_runs(business_id,id) ON DELETE CASCADE,
  FOREIGN KEY (business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE CASCADE,
  CHECK ((status='contacted') = (contacted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS recovery_members_business_customer
  ON recovery_members(business_id,customer_id);
CREATE INDEX IF NOT EXISTS recovery_members_run_sales
  ON recovery_members(business_id,run_id,recorded_sales_q DESC,customer_id);

ALTER TABLE recovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE recovery_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recovery_runs;
CREATE POLICY tenant_isolation ON recovery_runs
  USING (app.is_platform_admin() OR business_id=app.current_tenant())
  WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant());
DROP POLICY IF EXISTS tenant_isolation ON recovery_members;
CREATE POLICY tenant_isolation ON recovery_members
  USING (app.is_platform_admin() OR business_id=app.current_tenant())
  WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON recovery_runs,recovery_members FROM PUBLIC;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON recovery_runs,recovery_members TO %I',r);
    END IF;
  END LOOP;
END $$;
