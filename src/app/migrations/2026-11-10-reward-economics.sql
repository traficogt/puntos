-- Costs are separate from reward/customer contracts. No historical backfill:
-- missing historical snapshots must remain unknown.
CREATE UNIQUE INDEX IF NOT EXISTS rewards_economics_tenant_id ON rewards(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS redemptions_economics_tenant_id ON redemptions(business_id,id);
CREATE TABLE IF NOT EXISTS reward_unit_costs (
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 reward_id UUID NOT NULL,
 unit_cost_q NUMERIC(12,2) CHECK(unit_cost_q BETWEEN 0 AND 1000000),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
 PRIMARY KEY(business_id,reward_id),
 FOREIGN KEY(business_id,reward_id) REFERENCES rewards(business_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reward_economics_settings (
 business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
 gross_margin_pct NUMERIC(5,2) CHECK(gross_margin_pct BETWEEN 0 AND 100),
 cost_per_point_q NUMERIC(12,6) CHECK(cost_per_point_q BETWEEN 0 AND 1000),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS redemption_cost_snapshots (
 redemption_id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 reward_id UUID NOT NULL,
 points_cost INTEGER NOT NULL CHECK(points_cost>=0),
 unit_cost_q NUMERIC(12,2) CHECK(unit_cost_q BETWEEN 0 AND 1000000),
 redeemed_at TIMESTAMPTZ NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,redemption_id) REFERENCES redemptions(business_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS redemption_cost_snapshots_period ON redemption_cost_snapshots(business_id,redeemed_at);
CREATE OR REPLACE FUNCTION app.reject_redemption_cost_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Redemption cost snapshots are immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS redemption_cost_snapshot_immutable ON redemption_cost_snapshots;
CREATE TRIGGER redemption_cost_snapshot_immutable BEFORE UPDATE ON redemption_cost_snapshots
FOR EACH ROW EXECUTE FUNCTION app.reject_redemption_cost_snapshot_update();
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['reward_unit_costs','reward_economics_settings','redemption_cost_snapshots'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    IF t='redemption_cost_snapshots' THEN
     EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON %I FROM %I',t,r);
     EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    ELSE EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO %I',t,r);
    END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
