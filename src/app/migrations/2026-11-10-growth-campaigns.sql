-- Additive campaign snapshots: no historical ledger writes or automatic sends.
CREATE TABLE IF NOT EXISTS growth_campaigns (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  recovery_run_id UUID,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused')),
  bonus_points INTEGER NOT NULL CHECK (bonus_points BETWEEN 1 AND 10000),
  minimum_purchase_q NUMERIC(10,2) NOT NULL CHECK (minimum_purchase_q BETWEEN 0 AND 999999.99),
  duration_days INTEGER NOT NULL CHECK (duration_days IN (7,14,30)),
  holdout_percent INTEGER NOT NULL CHECK (holdout_percent IN (10,20,30)),
  estimated_cost_per_point_q NUMERIC CHECK (estimated_cost_per_point_q BETWEEN 0 AND 100),
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count BETWEEN 0 AND 200),
  treatment_count INTEGER NOT NULL DEFAULT 0 CHECK (treatment_count BETWEEN 0 AND 200),
  control_count INTEGER NOT NULL DEFAULT 0 CHECK (control_count BETWEEN 0 AND 200),
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  UNIQUE (business_id,id),
  UNIQUE (business_id,request_id),
  FOREIGN KEY (business_id,recovery_run_id) REFERENCES recovery_runs(business_id,id) ON DELETE SET NULL (recovery_run_id),
  CHECK ((status='draft' AND starts_at IS NULL AND expires_at IS NULL) OR
    (status IN ('active','paused') AND starts_at IS NOT NULL AND expires_at > starts_at AND treatment_count+control_count=member_count)),
  CHECK ((status='paused')=(paused_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS growth_campaigns_business_created ON growth_campaigns(business_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_growth_business_id ON transactions(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS customers_growth_business_id ON customers(business_id,id);
CREATE TABLE IF NOT EXISTS growth_campaign_members (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL,
  customer_id UUID,
  allocation TEXT CHECK (allocation IN ('treatment','control')),
  bonus_transaction_id UUID,
  bonus_points_awarded INTEGER NOT NULL DEFAULT 0 CHECK (bonus_points_awarded BETWEEN 0 AND 10000),
  claimed_at TIMESTAMPTZ,
  UNIQUE (business_id,id),
  UNIQUE (business_id,campaign_id,customer_id),
  UNIQUE (business_id,bonus_transaction_id),
  FOREIGN KEY (business_id,campaign_id) REFERENCES growth_campaigns(business_id,id) ON DELETE CASCADE,
  FOREIGN KEY (business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (business_id,bonus_transaction_id) REFERENCES transactions(business_id,id)
    ON DELETE SET NULL (bonus_transaction_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((claimed_at IS NULL AND bonus_points_awarded=0 AND bonus_transaction_id IS NULL) OR
    (claimed_at IS NOT NULL AND allocation='treatment' AND bonus_points_awarded>0))
);
CREATE INDEX IF NOT EXISTS growth_campaign_members_customer ON growth_campaign_members(business_id,customer_id,campaign_id);
ALTER TABLE growth_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE growth_campaign_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_campaign_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON growth_campaigns;
CREATE POLICY tenant_isolation ON growth_campaigns
 USING (app.is_platform_admin() OR business_id=app.current_tenant())
 WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant());
DROP POLICY IF EXISTS tenant_isolation ON growth_campaign_members;
CREATE POLICY tenant_isolation ON growth_campaign_members
 USING (app.is_platform_admin() OR business_id=app.current_tenant())
 WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON growth_campaigns,growth_campaign_members FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON growth_campaigns,growth_campaign_members TO %I',r);
  END IF;
 END LOOP;
END $$;
