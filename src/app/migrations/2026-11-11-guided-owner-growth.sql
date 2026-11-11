-- Opt-in guided growth; no historical backfill and no automatic enablement.
ALTER TABLE growth_campaigns DROP CONSTRAINT IF EXISTS growth_campaigns_duration_days_check;
ALTER TABLE growth_campaigns DROP CONSTRAINT IF EXISTS growth_campaigns_expansion_terms;
ALTER TABLE growth_campaigns ADD CONSTRAINT growth_campaigns_expansion_terms CHECK(
 (offer_kind='experiment' AND duration_days IN (7,14,30) AND duration_days IS NOT NULL AND duration_minutes IS NULL AND holdout_percent IN (10,20,30)) OR
 (offer_kind='quiet' AND duration_days IS NULL AND duration_minutes BETWEEN 30 AND 240 AND duration_minutes IS NOT NULL AND holdout_percent=0 AND points_budget IS NOT NULL AND member_count<=200) OR
 (offer_kind='second_visit' AND duration_days BETWEEN 1 AND 14 AND duration_days IS NOT NULL AND duration_minutes IS NULL AND holdout_percent=0 AND points_budget=bonus_points AND member_count=1 AND treatment_count=1 AND control_count=0)
);
CREATE TABLE IF NOT EXISTS second_visit_budgets (
 business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, month date NOT NULL,
 points_committed integer NOT NULL DEFAULT 0 CHECK(points_committed BETWEEN 0 AND 2000000),
 offers_created integer NOT NULL DEFAULT 0 CHECK(offers_created BETWEEN 0 AND 5000),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(business_id,month)
);
CREATE TABLE IF NOT EXISTS second_visit_enrollments (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 customer_id uuid, first_transaction_id uuid, campaign_id uuid NOT NULL, budget_month date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,customer_id), UNIQUE(business_id,campaign_id),
 FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE SET NULL(customer_id),
 FOREIGN KEY(business_id,first_transaction_id) REFERENCES transactions(business_id,id) ON DELETE SET NULL(first_transaction_id),
 FOREIGN KEY(business_id,campaign_id) REFERENCES growth_campaigns(business_id,id) ON DELETE CASCADE,
 FOREIGN KEY(business_id,budget_month) REFERENCES second_visit_budgets(business_id,month)
);
CREATE TABLE IF NOT EXISTS weekly_owner_briefs (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 owner_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 destination text NOT NULL CHECK(destination ~ '^[0-9]{8,15}$'),
 period_start date NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','accepted','failed','uncertain','suppressed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 claim_token uuid, lease_until timestamptz, accepted_at timestamptz,
 provider text, provider_reference text, reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,period_start)
);
CREATE INDEX IF NOT EXISTS weekly_owner_briefs_pending ON weekly_owner_briefs(business_id,next_attempt_at) WHERE status IN ('queued','failed','processing');
CREATE OR REPLACE FUNCTION app.guard_guided_growth_budget() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.points_committed<OLD.points_committed OR NEW.offers_created<OLD.offers_created THEN RAISE EXCEPTION 'Gross commitments cannot decrease' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.guard_weekly_brief_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.destination,NEW.period_start,NEW.snapshot,NEW.expires_at) IS DISTINCT FROM ROW(OLD.destination,OLD.period_start,OLD.snapshot,OLD.expires_at) OR (NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN RAISE EXCEPTION 'Weekly brief terms are immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_guided_growth_budget(),app.guard_weekly_brief_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS second_visit_budget_guard ON second_visit_budgets;
CREATE TRIGGER second_visit_budget_guard BEFORE UPDATE ON second_visit_budgets FOR EACH ROW EXECUTE FUNCTION app.guard_guided_growth_budget();
DROP TRIGGER IF EXISTS weekly_brief_snapshot_guard ON weekly_owner_briefs;
CREATE TRIGGER weekly_brief_snapshot_guard BEFORE UPDATE ON weekly_owner_briefs FOR EACH ROW EXECUTE FUNCTION app.guard_weekly_brief_snapshot();
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['second_visit_budgets','second_visit_enrollments','weekly_owner_briefs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE DELETE ON %I FROM %I',t,r);
    IF t='second_visit_enrollments' THEN EXECUTE format('REVOKE UPDATE ON %I FROM %I',t,r); EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    ELSE EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO %I',t,r); END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
