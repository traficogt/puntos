-- Additive campaign evidence. Never rewrite ledger dates or old assignments.
ALTER TABLE growth_campaigns ADD COLUMN IF NOT EXISTS measurement_plan jsonb,
 ADD COLUMN IF NOT EXISTS observation_ends_at timestamptz,
 ADD COLUMN IF NOT EXISTS reconciliation_ends_at timestamptz;
ALTER TABLE growth_campaign_members ADD COLUMN IF NOT EXISTS measurement_baseline jsonb;
ALTER TABLE growth_campaigns DROP CONSTRAINT IF EXISTS growth_campaigns_expansion_terms;
ALTER TABLE growth_campaigns ADD CONSTRAINT growth_campaigns_expansion_terms CHECK(
 (offer_kind='experiment' AND duration_days IN(7,14,30) AND duration_days IS NOT NULL AND duration_minutes IS NULL AND holdout_percent IN(10,20,30,50)) OR
 (offer_kind='quiet' AND duration_days IS NULL AND duration_minutes BETWEEN 30 AND 240 AND duration_minutes IS NOT NULL AND holdout_percent=0 AND points_budget IS NOT NULL AND member_count<=200));
ALTER TABLE growth_campaigns ADD CONSTRAINT growth_measurement_plan_shape CHECK(measurement_plan IS NULL OR
 (offer_kind='experiment' AND jsonb_typeof(measurement_plan)='object' AND measurement_plan->>'version'='1'
 AND (measurement_plan->>'observation_days')::int BETWEEN duration_days AND 180
 AND (measurement_plan->>'reconciliation_days')::int BETWEEN 0 AND 30));
ALTER TABLE growth_campaigns ADD CONSTRAINT growth_measurement_windows CHECK(
 (observation_ends_at IS NULL AND reconciliation_ends_at IS NULL) OR
 (starts_at IS NOT NULL AND observation_ends_at>=expires_at AND reconciliation_ends_at>=observation_ends_at));
CREATE OR REPLACE FUNCTION app.guard_growth_measurement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.measurement_plan IS DISTINCT FROM OLD.measurement_plan OR
 (OLD.starts_at IS NOT NULL AND ROW(NEW.observation_ends_at,NEW.reconciliation_ends_at) IS DISTINCT FROM ROW(OLD.observation_ends_at,OLD.reconciliation_ends_at)) THEN
  RAISE EXCEPTION 'Campaign measurement design is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER growth_measurement_guard BEFORE UPDATE ON growth_campaigns FOR EACH ROW EXECUTE FUNCTION app.guard_growth_measurement();
CREATE OR REPLACE FUNCTION app.guard_growth_baseline() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.measurement_baseline IS NOT NULL AND NEW.measurement_baseline IS DISTINCT FROM OLD.measurement_baseline THEN
  RAISE EXCEPTION 'Campaign baseline is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER growth_baseline_guard BEFORE UPDATE ON growth_campaign_members FOR EACH ROW EXECUTE FUNCTION app.guard_growth_baseline();
CREATE TABLE growth_measurement_costs(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,campaign_id uuid NOT NULL,
 request_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 UNIQUE(business_id,campaign_id,request_id),UNIQUE(business_id,campaign_id,revision),
 FOREIGN KEY(business_id,campaign_id) REFERENCES growth_campaigns(business_id,id) ON DELETE CASCADE);
CREATE TABLE growth_measurement_reports(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,campaign_id uuid NOT NULL,
 request_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 UNIQUE(business_id,campaign_id,request_id),UNIQUE(business_id,campaign_id,revision),
 FOREIGN KEY(business_id,campaign_id) REFERENCES growth_campaigns(business_id,id) ON DELETE CASCADE);
CREATE OR REPLACE FUNCTION app.guard_growth_measurement_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 -- Allow FK anonymization of the staff actor only; evidence never changes.
 IF (to_jsonb(NEW)-'created_by_staff_id') IS DISTINCT FROM (to_jsonb(OLD)-'created_by_staff_id') THEN
  RAISE EXCEPTION 'Measurement evidence is append only' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;r text; BEGIN
 FOREACH t IN ARRAY ARRAY['growth_measurement_costs','growth_measurement_reports'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('CREATE TRIGGER measurement_evidence_guard BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.guard_growth_measurement_evidence()',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT FROM pg_roles WHERE rolname=r AND oid<>(SELECT relowner FROM pg_class WHERE oid=to_regclass(t))) THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r);
    EXECUTE format('GRANT SELECT,INSERT ON TABLE %I TO %I',t,r);
   END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.guard_growth_measurement(),app.guard_growth_baseline(),app.guard_growth_measurement_evidence() FROM PUBLIC;
