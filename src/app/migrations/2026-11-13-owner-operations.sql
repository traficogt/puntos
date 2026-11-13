-- Additive owner workflows. Existing issued values deliberately remain unknown.
ALTER TABLE merchant_decision_reviews DROP CONSTRAINT IF EXISTS merchant_decision_reviews_status_check;
ALTER TABLE merchant_decision_reviews ADD CONSTRAINT merchant_decision_reviews_status_check CHECK(status IN ('open','snoozed','reviewed','dismissed'));
ALTER TABLE merchant_decision_reviews ADD COLUMN IF NOT EXISTS assigned_staff_id uuid,ADD COLUMN IF NOT EXISTS dismiss_reason text;
ALTER TABLE merchant_decision_reviews ADD CONSTRAINT decision_assignee_tenant FOREIGN KEY(business_id,assigned_staff_id) REFERENCES staff_users(business_id,id);
ALTER TABLE merchant_decision_reviews ADD CONSTRAINT decision_dismiss_reason CHECK((status='dismissed' AND length(btrim(dismiss_reason)) BETWEEN 3 AND 500) OR (status<>'dismissed' AND dismiss_reason IS NULL));
CREATE TABLE merchant_decision_events(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),decision_key text NOT NULL,version integer NOT NULL,actor_staff_id uuid NOT NULL,
 evidence_fingerprint text NOT NULL,status text NOT NULL,assigned_staff_id uuid,dismiss_reason text,snoozed_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,decision_key,version),FOREIGN KEY(business_id,actor_staff_id) REFERENCES staff_users(business_id,id),FOREIGN KEY(business_id,assigned_staff_id) REFERENCES staff_users(business_id,id)
);
ALTER TABLE reward_unit_costs ADD COLUMN IF NOT EXISTS retail_value_q numeric(12,2) CHECK(retail_value_q BETWEEN 0 AND 1000000);
CREATE TABLE issued_commitment_values(
 business_id uuid NOT NULL REFERENCES businesses(id),source_kind text NOT NULL CHECK(source_kind IN ('protected_reward','hospitality','offer')),source_id uuid NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),retail_value numeric(14,2) CHECK(retail_value>=0),fulfillment_cost numeric(14,6) CHECK(fulfillment_cost>=0),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(business_id,source_kind,source_id)
);
CREATE OR REPLACE FUNCTION app.snapshot_issued_commitment_value() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid;kind text;sid uuid;rid uuid;retail numeric;cost numeric;curr text;
BEGIN
 bid:=NEW.business_id;sid:=NEW.id;
 IF TG_TABLE_NAME='growth_campaigns' THEN
  IF NEW.status<>'active' OR OLD.status='active' THEN RETURN NEW;END IF;
  kind:='offer';cost:=NEW.estimated_cost_per_point_q*NEW.bonus_points;
 ELSE
  kind:=CASE TG_TABLE_NAME WHEN 'customer_reward_promises' THEN 'protected_reward' ELSE 'hospitality' END;rid:=NEW.reward_id;
  SELECT c.retail_value_q,c.unit_cost_q INTO retail,cost FROM reward_unit_costs c WHERE c.business_id=bid AND c.reward_id=rid;
 END IF;
 SELECT COALESCE(NULLIF(b.program_json->'region'->>'currency',''),'GTQ') INTO curr FROM businesses b WHERE b.id=bid;
 INSERT INTO issued_commitment_values(business_id,source_kind,source_id,currency,retail_value,fulfillment_cost) VALUES(bid,kind,sid,curr,retail,cost) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER snapshot_issued_promise AFTER INSERT ON customer_reward_promises FOR EACH ROW EXECUTE FUNCTION app.snapshot_issued_commitment_value();
CREATE TRIGGER snapshot_issued_hospitality AFTER INSERT ON hospitality_entitlements FOR EACH ROW EXECUTE FUNCTION app.snapshot_issued_commitment_value();
CREATE TRIGGER snapshot_issued_offer AFTER UPDATE OF status ON growth_campaigns FOR EACH ROW EXECUTE FUNCTION app.snapshot_issued_commitment_value();
CREATE TABLE operating_offer_templates(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),source_campaign_id uuid NOT NULL,name text NOT NULL,terms jsonb NOT NULL,
 maximum_runs integer NOT NULL CHECK(maximum_runs BETWEEN 1 AND 100),used_runs integer NOT NULL DEFAULT 0 CHECK(used_runs BETWEEN 0 AND maximum_runs),
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 200),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by_staff_id uuid NOT NULL,revoked_at timestamptz,version integer NOT NULL DEFAULT 1,request_id uuid NOT NULL,payload_fingerprint text NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,request_id),FOREIGN KEY(business_id,source_campaign_id) REFERENCES growth_campaigns(business_id,id),FOREIGN KEY(business_id,created_by_staff_id) REFERENCES staff_users(business_id,id)
);
CREATE OR REPLACE FUNCTION app.protect_operating_template_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-'used_runs'-'revoked_at'-'version')=(to_jsonb(NEW)-'used_runs'-'revoked_at'-'version')
  AND NEW.used_runs>=OLD.used_runs AND NEW.version=OLD.version+1 AND (OLD.revoked_at IS NULL OR NEW.revoked_at=OLD.revoked_at) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'Approved operating template terms are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER protect_operating_template_terms BEFORE UPDATE OR DELETE ON operating_offer_templates FOR EACH ROW EXECUTE FUNCTION app.protect_operating_template_terms();
CREATE TABLE operating_template_runs(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,template_id uuid NOT NULL,campaign_id uuid NOT NULL,request_id uuid NOT NULL,staff_id uuid NOT NULL,payload_fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,request_id),FOREIGN KEY(business_id,template_id) REFERENCES operating_offer_templates(business_id,id),FOREIGN KEY(business_id,campaign_id) REFERENCES growth_campaigns(business_id,id),FOREIGN KEY(business_id,staff_id) REFERENCES staff_users(business_id,id)
);
CREATE TABLE operating_mode_changes(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),request_id uuid NOT NULL,staff_id uuid NOT NULL,payload_fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,request_id),FOREIGN KEY(business_id,staff_id) REFERENCES staff_users(business_id,id)
);
CREATE OR REPLACE FUNCTION app.protect_owner_operation_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Owner operation history is immutable' USING ERRCODE='23514';END $$;
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['merchant_decision_events','issued_commitment_values','operating_offer_templates','operating_template_runs','operating_mode_changes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  IF t<>'operating_offer_templates' THEN EXECUTE format('CREATE TRIGGER protect_owner_operation_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.protect_owner_operation_history()',t);END IF;
  REVOKE ALL ON issued_commitment_values,merchant_decision_events,operating_offer_templates,operating_template_runs,operating_mode_changes FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    IF t='operating_offer_templates' THEN EXECUTE format('GRANT UPDATE ON %I TO %I',t,r);END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
