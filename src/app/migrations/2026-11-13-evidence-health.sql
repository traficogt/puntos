CREATE TABLE IF NOT EXISTS ingestion_health_events (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 monitor_id UUID NOT NULL,
 request_id UUID NOT NULL,
 fingerprint TEXT NOT NULL,
 details JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(business_id,request_id)
);
CREATE INDEX IF NOT EXISTS ingestion_health_recent ON ingestion_health_events(business_id,created_at DESC);

CREATE TABLE IF NOT EXISTS transaction_evidence_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL CHECK(event_type IN ('recorded','changed')),
 previous_state JSONB,
 recorded_state JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS transaction_evidence_history ON transaction_evidence_events(business_id,transaction_id,created_at,id);
CREATE TABLE IF NOT EXISTS redemption_evidence_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 redemption_id UUID NOT NULL REFERENCES redemptions(id) ON DELETE CASCADE,
 previous_status TEXT,
 recorded_status TEXT NOT NULL,
 points_cost INTEGER NOT NULL,
 branch_id UUID,
 staff_user_id UUID,
 rule_snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS redemption_evidence_history ON redemption_evidence_events(business_id,redemption_id,created_at,id);
CREATE OR REPLACE FUNCTION app.capture_redemption_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior text; terms jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (OLD.status,OLD.points_cost,OLD.branch_id,OLD.staff_user_id) IS NOT DISTINCT FROM (NEW.status,NEW.points_cost,NEW.branch_id,NEW.staff_user_id) THEN RETURN NEW; END IF;
  prior:=OLD.status;
 END IF;
 SELECT jsonb_build_object('reward_id',r.id,'name',r.name,'description',r.description,'active',r.active,
  'configured_points_cost',r.points_cost,'valid_until',r.valid_until,
  'branch_ids',COALESCE((SELECT jsonb_agg(rb.branch_id ORDER BY rb.branch_id) FROM reward_branches rb WHERE rb.reward_id=r.id),'[]'::jsonb),
  'evidence','configuration_observed_at_event') INTO terms FROM rewards r WHERE r.business_id=NEW.business_id AND r.id=NEW.reward_id;
 INSERT INTO redemption_evidence_events(business_id,redemption_id,previous_status,recorded_status,points_cost,branch_id,staff_user_id,rule_snapshot)
 VALUES(NEW.business_id,NEW.id,prior,NEW.status,NEW.points_cost,NEW.branch_id,NEW.staff_user_id,COALESCE(terms,'{}'::jsonb));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_redemption_evidence ON redemptions;
CREATE TRIGGER record_redemption_evidence AFTER INSERT OR UPDATE ON redemptions FOR EACH ROW EXECUTE FUNCTION app.capture_redemption_evidence();
CREATE OR REPLACE FUNCTION app.capture_transaction_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_state jsonb; after_state jsonb;
BEGIN
 after_state := jsonb_build_object('status',NEW.status,'points',NEW.points,'amount_q',NEW.amount_q,'visits',NEW.visits,'items',NEW.items,
   'source',NEW.source,'type',NEW.type,'staff_user_id',NEW.staff_user_id,'branch_id',NEW.branch_id,
   'available_at',NEW.available_at,'original_transaction_id',NEW.original_transaction_id,'reversed_transaction_id',NEW.reversed_transaction_id,
   'award_evidence',NEW.meta->'award_evidence','redemption_id',NEW.meta->'redemption_id');
 IF TG_OP='UPDATE' THEN
  before_state := jsonb_build_object('status',OLD.status,'points',OLD.points,'amount_q',OLD.amount_q,'visits',OLD.visits,'items',OLD.items,
   'source',OLD.source,'type',OLD.type,'staff_user_id',OLD.staff_user_id,'branch_id',OLD.branch_id,
   'available_at',OLD.available_at,'original_transaction_id',OLD.original_transaction_id,'reversed_transaction_id',OLD.reversed_transaction_id,
   'award_evidence',OLD.meta->'award_evidence','redemption_id',OLD.meta->'redemption_id');
  IF before_state=after_state THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO transaction_evidence_events(business_id,transaction_id,event_type,previous_state,recorded_state)
 VALUES(NEW.business_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'recorded' ELSE 'changed' END,before_state,after_state);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_transaction_evidence ON transactions;
CREATE TRIGGER record_transaction_evidence AFTER INSERT OR UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION app.capture_transaction_evidence();

CREATE OR REPLACE FUNCTION app.reject_operation_evidence_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operation evidence is immutable' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text;r text; BEGIN
 FOREACH t IN ARRAY ARRAY['ingestion_health_events','transaction_evidence_events','redemption_evidence_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('DROP TRIGGER IF EXISTS protect_operation_evidence ON %I',t);
  EXECUTE format('CREATE TRIGGER protect_operation_evidence BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.reject_operation_evidence_update()',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON %I FROM %I',t,r);
   END IF;
  END LOOP;
 END LOOP;
END $$;
