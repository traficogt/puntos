-- Quiet offers share the one-bonus ledger. Bulk preparation never activates or sends.
ALTER TABLE growth_campaigns ADD COLUMN IF NOT EXISTS offer_kind text NOT NULL DEFAULT 'experiment',
 ADD COLUMN IF NOT EXISTS duration_minutes integer,
 ADD COLUMN IF NOT EXISTS preparation_status text NOT NULL DEFAULT 'ready',
 ADD COLUMN IF NOT EXISTS prepared_count integer NOT NULL DEFAULT 0;
ALTER TABLE growth_campaigns ALTER COLUMN duration_days DROP NOT NULL;
ALTER TABLE growth_campaigns DROP CONSTRAINT IF EXISTS growth_campaigns_holdout_percent_check;
ALTER TABLE growth_campaigns DROP CONSTRAINT IF EXISTS growth_campaigns_member_count_check;
ALTER TABLE growth_campaigns DROP CONSTRAINT IF EXISTS growth_campaigns_treatment_count_check;
ALTER TABLE growth_campaigns DROP CONSTRAINT IF EXISTS growth_campaigns_control_count_check;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='growth_campaigns'::regclass AND conname='growth_campaigns_expansion_terms') THEN
  ALTER TABLE growth_campaigns ADD CONSTRAINT growth_campaigns_expansion_terms CHECK(
   (offer_kind='experiment' AND duration_days IN (7,14,30) AND duration_days IS NOT NULL AND duration_minutes IS NULL AND holdout_percent IN (10,20,30)) OR
   (offer_kind='quiet' AND duration_days IS NULL AND duration_minutes BETWEEN 30 AND 240 AND duration_minutes IS NOT NULL AND holdout_percent=0 AND points_budget IS NOT NULL AND member_count<=200)
  );
  ALTER TABLE growth_campaigns ADD CONSTRAINT growth_campaigns_expansion_counts CHECK(
   member_count BETWEEN 0 AND 5000 AND treatment_count BETWEEN 0 AND 5000 AND control_count BETWEEN 0 AND 5000 AND prepared_count BETWEEN 0 AND 5000
  );
  ALTER TABLE growth_campaigns ADD CONSTRAINT growth_campaigns_preparation_status CHECK(
   preparation_status IN ('queued','preparing','ready','failed','cancelled') AND (status='draft' OR preparation_status='ready')
  );
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS growth_campaign_preparations (
 business_id uuid NOT NULL, campaign_id uuid NOT NULL, customer_ids uuid[],
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 snapshot_at timestamptz, job_id uuid NOT NULL REFERENCES background_jobs(id),
 last_error text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(business_id,campaign_id),
 FOREIGN KEY(business_id,campaign_id) REFERENCES growth_campaigns(business_id,id) ON DELETE CASCADE,
 CHECK(customer_ids IS NULL OR cardinality(customer_ids)<=5000)
);
CREATE TABLE IF NOT EXISTS growth_campaign_preflights (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, campaign_id uuid NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), snapshot jsonb NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,campaign_id) REFERENCES growth_campaigns(business_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS growth_campaign_preflights_recent ON growth_campaign_preflights(business_id,campaign_id,created_at DESC);
CREATE OR REPLACE FUNCTION app.guard_growth_expansion_terms() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.starts_at IS NOT NULL AND ROW(NEW.offer_kind,NEW.bonus_points,NEW.minimum_purchase_q,NEW.duration_days,NEW.duration_minutes,NEW.holdout_percent,NEW.estimated_cost_per_point_q,NEW.audience_snapshot,NEW.starts_at,NEW.expires_at)
  IS DISTINCT FROM ROW(OLD.offer_kind,OLD.bonus_points,OLD.minimum_purchase_q,OLD.duration_days,OLD.duration_minutes,OLD.holdout_percent,OLD.estimated_cost_per_point_q,OLD.audience_snapshot,OLD.starts_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'Activated offer terms are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.prepared_count<OLD.prepared_count OR (OLD.preparation_status='cancelled' AND NEW.preparation_status<>'cancelled') THEN
  RAISE EXCEPTION 'Preparation progress and cancellation are permanent' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.guard_growth_preparation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.customer_ids IS NOT NULL AND ROW(NEW.customer_ids,NEW.snapshot_at) IS DISTINCT FROM ROW(OLD.customer_ids,OLD.snapshot_at) THEN
  RAISE EXCEPTION 'Preparation customer snapshot is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint THEN
  RAISE EXCEPTION 'Preparation request is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_growth_expansion_terms(),app.guard_growth_preparation_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS growth_campaigns_terms_guard ON growth_campaigns;
CREATE TRIGGER growth_campaigns_terms_guard BEFORE UPDATE ON growth_campaigns FOR EACH ROW EXECUTE FUNCTION app.guard_growth_expansion_terms();
DROP TRIGGER IF EXISTS growth_preparations_snapshot_guard ON growth_campaign_preparations;
CREATE TRIGGER growth_preparations_snapshot_guard BEFORE UPDATE ON growth_campaign_preparations FOR EACH ROW EXECUTE FUNCTION app.guard_growth_preparation_snapshot();
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['growth_campaign_preparations','growth_campaign_preflights'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE DELETE ON %I FROM %I',t,r);
    IF t='growth_campaign_preflights' THEN EXECUTE format('REVOKE UPDATE ON %I FROM %I',t,r); EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    ELSE EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO %I',t,r); END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
