-- Only observed current progress is protected. No historical promises are inferred.
CREATE UNIQUE INDEX IF NOT EXISTS promises_customer_tenant ON customers(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS promises_staff_tenant ON staff_users(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS promises_branch_tenant ON branches(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS promises_reward_tenant ON rewards(business_id,id);
CREATE TABLE IF NOT EXISTS reward_promise_cycles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id),customer_id uuid NOT NULL,
 program_type text NOT NULL,earning_terms jsonb NOT NULL,progress_points integer NOT NULL,pending_points integer NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,completed_redemption_id uuid REFERENCES redemptions(id),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS promise_one_open_cycle ON reward_promise_cycles(business_id,customer_id) WHERE completed_at IS NULL;
CREATE TABLE IF NOT EXISTS customer_reward_promises(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL,cycle_id uuid NOT NULL,reward_id uuid NOT NULL,
 reward_name text NOT NULL,description text,points_cost integer NOT NULL CHECK(points_cost>=0),valid_until timestamptz,branch_ids uuid[] NOT NULL,
 UNIQUE(business_id,id),UNIQUE(cycle_id,reward_id),FOREIGN KEY(business_id,cycle_id) REFERENCES reward_promise_cycles(business_id,id),FOREIGN KEY(business_id,reward_id) REFERENCES rewards(business_id,id)
);
CREATE TABLE IF NOT EXISTS reward_availability(
 business_id uuid NOT NULL,reward_id uuid NOT NULL,available boolean NOT NULL DEFAULT true,alternative_reward_ids uuid[] NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by_staff_id uuid NOT NULL,
 PRIMARY KEY(business_id,reward_id),FOREIGN KEY(business_id,reward_id) REFERENCES rewards(business_id,id),FOREIGN KEY(business_id,updated_by_staff_id) REFERENCES staff_users(business_id,id)
);
CREATE TABLE IF NOT EXISTS hospitality_grants(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),staff_id uuid NOT NULL,branch_id uuid,reward_id uuid NOT NULL,reward_name text NOT NULL,description text,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 total_units integer NOT NULL CHECK(total_units BETWEEN 1 AND 10000),used_units integer NOT NULL DEFAULT 0 CHECK(used_units BETWEEN 0 AND total_units),
 total_cost numeric(14,2) NOT NULL CHECK(total_cost>=0),unit_cost_limit numeric(12,2) NOT NULL CHECK(unit_cost_limit>=0 AND unit_cost_limit<=total_cost),used_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK(used_cost BETWEEN 0 AND total_cost),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '31 days'),valid_hours integer NOT NULL CHECK(valid_hours BETWEEN 1 AND 2160),
 request_id uuid NOT NULL,payload_fingerprint text NOT NULL,created_by_staff_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz,
 UNIQUE(business_id,id),UNIQUE(business_id,request_id),FOREIGN KEY(business_id,staff_id) REFERENCES staff_users(business_id,id),FOREIGN KEY(business_id,branch_id) REFERENCES branches(business_id,id),FOREIGN KEY(business_id,reward_id) REFERENCES rewards(business_id,id),FOREIGN KEY(business_id,created_by_staff_id) REFERENCES staff_users(business_id,id)
);
CREATE TABLE IF NOT EXISTS hospitality_entitlements(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,grant_id uuid NOT NULL,customer_id uuid NOT NULL,issued_by_staff_id uuid NOT NULL,branch_id uuid,reward_id uuid NOT NULL,
 reward_name text NOT NULL,description text,title text NOT NULL,unit_cost_limit numeric(12,2) NOT NULL,approved_cost numeric(12,2) NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,request_id uuid NOT NULL,payload_fingerprint text NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,request_id),FOREIGN KEY(business_id,grant_id) REFERENCES hospitality_grants(business_id,id),FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id),FOREIGN KEY(business_id,issued_by_staff_id) REFERENCES staff_users(business_id,id),FOREIGN KEY(business_id,branch_id) REFERENCES branches(business_id,id),FOREIGN KEY(business_id,reward_id) REFERENCES rewards(business_id,id)
);
CREATE TABLE IF NOT EXISTS reward_entitlement_fulfillments(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,promise_id uuid,hospitality_id uuid,redemption_id uuid NOT NULL UNIQUE REFERENCES redemptions(id),
 original_reward_id uuid NOT NULL,fulfilled_reward_id uuid NOT NULL,fulfilled_reward_name text NOT NULL,customer_accepted boolean NOT NULL,request_id uuid NOT NULL,payload_fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(business_id,request_id),UNIQUE(hospitality_id),
 CHECK((promise_id IS NULL)<>(hospitality_id IS NULL)),FOREIGN KEY(business_id,promise_id) REFERENCES customer_reward_promises(business_id,id),FOREIGN KEY(business_id,hospitality_id) REFERENCES hospitality_entitlements(business_id,id),
 FOREIGN KEY(business_id,original_reward_id) REFERENCES rewards(business_id,id),FOREIGN KEY(business_id,fulfilled_reward_id) REFERENCES rewards(business_id,id)
);
CREATE INDEX IF NOT EXISTS hospitality_customer_current ON hospitality_entitlements(business_id,customer_id,expires_at);
CREATE OR REPLACE FUNCTION app.reward_base_terms(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('points_per_q',COALESCE(j->'points_per_q','0.1'::jsonb),'points_per_visit',COALESCE(j->'points_per_visit','10'::jsonb),'points_per_item',COALESCE(j->'points_per_item','1'::jsonb),'round',COALESCE(j->'round','"ceil"'::jsonb)) $$;
CREATE OR REPLACE FUNCTION app.capture_reward_cycles(bid uuid,ptype text,terms jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE bal record;cycle uuid;
BEGIN
 -- Balance locks serialize snapshots with awards and redemptions; stable order
 -- prevents two configuration edits from taking customer locks in reverse order.
 FOR bal IN SELECT cb.* FROM customer_balances cb JOIN customers c ON c.id=cb.customer_id
 WHERE c.business_id=bid AND c.deleted_at IS NULL AND cb.points+cb.pending_points>0 ORDER BY cb.customer_id FOR UPDATE OF cb LOOP
  IF NOT EXISTS(SELECT 1 FROM rewards WHERE business_id=bid AND active AND (valid_until IS NULL OR valid_until>clock_timestamp())) THEN CONTINUE; END IF;
  INSERT INTO reward_promise_cycles(business_id,customer_id,program_type,earning_terms,progress_points,pending_points)
  VALUES(bid,bal.customer_id,ptype,terms,bal.points,bal.pending_points) ON CONFLICT DO NOTHING RETURNING id INTO cycle;
  IF cycle IS NOT NULL THEN
   INSERT INTO customer_reward_promises(business_id,cycle_id,reward_id,reward_name,description,points_cost,valid_until,branch_ids)
   SELECT bid,cycle,r.id,r.name,r.description,r.points_cost,r.valid_until,ARRAY(SELECT rb.branch_id FROM reward_branches rb WHERE rb.reward_id=r.id ORDER BY rb.branch_id)
   FROM rewards r WHERE r.business_id=bid AND r.active AND (r.valid_until IS NULL OR r.valid_until>clock_timestamp());
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app.reward_effective_terms(ptype text,j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE ptype WHEN 'SPEND' THEN jsonb_build_object('rate',app.reward_base_terms(j)->'points_per_q','round',app.reward_base_terms(j)->'round') WHEN 'VISIT' THEN jsonb_build_object('rate',app.reward_base_terms(j)->'points_per_visit') ELSE jsonb_build_object('rate',app.reward_base_terms(j)->'points_per_item') END $$;
CREATE OR REPLACE FUNCTION app.capture_program_promise() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(OLD.program_type,app.reward_effective_terms(OLD.program_type,OLD.program_json)) IS DISTINCT FROM ROW(NEW.program_type,app.reward_effective_terms(NEW.program_type,NEW.program_json)) THEN
  PERFORM app.capture_reward_cycles(OLD.id,OLD.program_type,app.reward_base_terms(OLD.program_json)||jsonb_build_object('region',COALESCE(OLD.program_json->'region','{}'::jsonb)));
 END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.capture_reward_promise() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE business businesses%ROWTYPE;rid uuid;
BEGIN
 IF TG_TABLE_NAME='rewards' THEN
  -- Inactive rewards have not offered current progress a redeemable target.
  -- Creation assigns branches while inactive and publishes in its last step.
  IF OLD.active IS NOT TRUE THEN RETURN NEW;END IF;
  IF ROW(OLD.name,OLD.description,OLD.points_cost,OLD.active,OLD.valid_until) IS NOT DISTINCT FROM ROW(NEW.name,NEW.description,NEW.points_cost,NEW.active,NEW.valid_until) THEN RETURN NEW;END IF;
  SELECT * INTO business FROM businesses WHERE id=OLD.business_id;
 ELSE
  rid:=CASE WHEN TG_OP='DELETE' THEN OLD.reward_id ELSE NEW.reward_id END;
  SELECT b.* INTO business FROM businesses b JOIN rewards r ON r.business_id=b.id WHERE r.id=rid AND r.active;
  IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 END IF;
 PERFORM app.capture_reward_cycles(business.id,business.program_type,app.reward_base_terms(business.program_json)||jsonb_build_object('region',COALESCE(business.program_json->'region','{}'::jsonb)));
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
DROP TRIGGER IF EXISTS protect_program_progress ON businesses;
CREATE TRIGGER protect_program_progress BEFORE UPDATE OF program_type,program_json ON businesses FOR EACH ROW EXECUTE FUNCTION app.capture_program_promise();
DROP TRIGGER IF EXISTS protect_reward_progress ON rewards;
CREATE TRIGGER protect_reward_progress BEFORE UPDATE ON rewards FOR EACH ROW EXECUTE FUNCTION app.capture_reward_promise();
DROP TRIGGER IF EXISTS protect_reward_branch_progress ON reward_branches;
CREATE TRIGGER protect_reward_branch_progress BEFORE INSERT OR DELETE ON reward_branches FOR EACH ROW EXECUTE FUNCTION app.capture_reward_promise();
CREATE OR REPLACE FUNCTION app.protect_promise_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='reward_promise_cycles' AND TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'completed_at'-'completed_redemption_id')=(to_jsonb(OLD)-'completed_at'-'completed_redemption_id') AND OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL AND NEW.completed_redemption_id IS NOT NULL THEN RETURN NEW;END IF;
 ELSIF TG_TABLE_NAME='hospitality_grants' AND TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'used_units'-'used_cost'-'revoked_at')=(to_jsonb(OLD)-'used_units'-'used_cost'-'revoked_at') AND NEW.used_units>=OLD.used_units AND NEW.used_cost>=OLD.used_cost AND (OLD.revoked_at IS NULL OR NEW.revoked_at=OLD.revoked_at) THEN RETURN NEW;END IF;
 END IF;
 RAISE EXCEPTION 'Reward promise and hospitality history is immutable' USING ERRCODE='23514';
END $$;
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['reward_promise_cycles','customer_reward_promises','reward_availability','hospitality_grants','hospitality_entitlements','reward_entitlement_fulfillments'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  IF t<>'reward_availability' THEN EXECUTE format('DROP TRIGGER IF EXISTS protect_promise_history ON %I',t);EXECUTE format('CREATE TRIGGER protect_promise_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.protect_promise_history()',t);END IF;
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    IF t IN ('reward_promise_cycles','reward_availability','hospitality_grants') THEN EXECUTE format('GRANT UPDATE ON %I TO %I',t,r);END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
