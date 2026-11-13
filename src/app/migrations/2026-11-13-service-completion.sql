-- Extend bounded service grants without rewriting historical authorizations or usage.
ALTER TABLE staff_service_grants DROP CONSTRAINT IF EXISTS staff_service_grants_action_check;
ALTER TABLE staff_service_grants ADD CONSTRAINT staff_service_grants_action_check CHECK(action IN ('restore_redemption','extend_promise','fulfill_promise','operating_mode','offer_template','assigned_decision'));
ALTER TABLE staff_service_grants ADD COLUMN IF NOT EXISTS currency text, ADD COLUMN IF NOT EXISTS max_actions integer NOT NULL DEFAULT 100000 CHECK(max_actions BETWEEN 1 AND 100000),
 ADD COLUMN IF NOT EXISTS used_actions integer NOT NULL DEFAULT 0 CHECK(used_actions>=0),
 ADD COLUMN IF NOT EXISTS frequency_limit integer NOT NULL DEFAULT 100000 CHECK(frequency_limit BETWEEN 1 AND 100000),
 ADD COLUMN IF NOT EXISTS frequency_minutes integer NOT NULL DEFAULT 1440 CHECK(frequency_minutes BETWEEN 1 AND 44640),
 ADD COLUMN IF NOT EXISTS per_action_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK(per_action_cost>=0),
 ADD COLUMN IF NOT EXISTS total_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK(total_cost>=per_action_cost),
 ADD COLUMN IF NOT EXISTS used_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK(used_cost>=0 AND used_cost<=total_cost);
ALTER TABLE staff_service_usage DROP CONSTRAINT IF EXISTS staff_service_usage_action_check;
ALTER TABLE staff_service_usage DROP CONSTRAINT IF EXISTS staff_service_usage_points_check;
ALTER TABLE staff_service_usage ADD CONSTRAINT staff_service_usage_action_check CHECK(action IN ('restore_redemption','extend_promise','fulfill_promise','operating_mode','offer_template','assigned_decision'));
ALTER TABLE staff_service_usage ADD CONSTRAINT staff_service_usage_points_check CHECK(points>=0);
ALTER TABLE staff_service_usage ADD COLUMN IF NOT EXISTS currency text, ADD COLUMN IF NOT EXISTS cost_amount numeric(20,6) NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS reference_type text, ADD COLUMN IF NOT EXISTS reference_id uuid;

CREATE TABLE IF NOT EXISTS staff_auto_briefings(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),branch_id uuid,scope_key text NOT NULL,
 version integer NOT NULL DEFAULT 1,payload_fingerprint text NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(business_id,id),
 FOREIGN KEY(business_id,branch_id) REFERENCES branches(business_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_auto_briefing_version ON staff_auto_briefings(business_id,scope_key,version);
CREATE TABLE IF NOT EXISTS staff_auto_briefing_acknowledgements(
 business_id uuid NOT NULL,briefing_id uuid NOT NULL,staff_id uuid NOT NULL,acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(business_id,briefing_id,staff_id),FOREIGN KEY(business_id,briefing_id) REFERENCES staff_auto_briefings(business_id,id),FOREIGN KEY(business_id,staff_id) REFERENCES staff_users(business_id,id)
);
ALTER TABLE service_cases ADD COLUMN IF NOT EXISTS assigned_staff_id uuid,ADD COLUMN IF NOT EXISTS escalated_at timestamptz,ADD COLUMN IF NOT EXISTS escalation_reason text;
ALTER TABLE service_cases DROP CONSTRAINT IF EXISTS service_case_assigned_tenant_fk;
ALTER TABLE service_cases ADD CONSTRAINT service_case_assigned_tenant_fk FOREIGN KEY(business_id,assigned_staff_id) REFERENCES staff_users(business_id,id);
ALTER TABLE service_case_events DROP CONSTRAINT IF EXISTS service_case_events_event_type_check;
ALTER TABLE service_case_events ADD CONSTRAINT service_case_events_event_type_check CHECK(event_type IN ('reported','resolved','assigned','escalated','expiry_extended'));
CREATE UNIQUE INDEX IF NOT EXISTS customer_reward_promises_tenant_id ON customer_reward_promises(business_id,id);
CREATE TABLE IF NOT EXISTS reward_promise_extensions(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,promise_id uuid NOT NULL,previous_valid_until timestamptz,extended_until timestamptz NOT NULL,
 reason text NOT NULL,actor_staff_id uuid NOT NULL,request_id uuid NOT NULL,payload_fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,request_id),FOREIGN KEY(business_id,promise_id) REFERENCES customer_reward_promises(business_id,id),FOREIGN KEY(business_id,actor_staff_id) REFERENCES staff_users(business_id,id)
);
CREATE TABLE IF NOT EXISTS staff_rehearsals(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,staff_id uuid NOT NULL,config_fingerprint text NOT NULL,state jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,
 UNIQUE(business_id,id),FOREIGN KEY(business_id,staff_id) REFERENCES staff_users(business_id,id)
);
CREATE TABLE IF NOT EXISTS staff_rehearsal_events(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,rehearsal_id uuid NOT NULL,request_id uuid NOT NULL,payload_fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,request_id),FOREIGN KEY(business_id,rehearsal_id) REFERENCES staff_rehearsals(business_id,id)
);
ALTER TABLE customer_migration_batches ADD COLUMN IF NOT EXISTS source_evidence jsonb;
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['staff_auto_briefings','staff_auto_briefing_acknowledgements','reward_promise_extensions','staff_rehearsals','staff_rehearsal_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  IF t<>'staff_rehearsals' THEN EXECUTE format('DROP TRIGGER IF EXISTS service_completion_immutable ON %I',t); EXECUTE format('CREATE TRIGGER service_completion_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.reject_staff_delegation_history_change()',t); END IF;
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    IF t='staff_rehearsals' THEN EXECUTE format('GRANT UPDATE ON %I TO %I',t,r); END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
