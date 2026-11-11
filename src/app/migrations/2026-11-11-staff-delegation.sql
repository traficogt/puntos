-- Predefined service authority is independent of broad staff roles. No balance changes.
CREATE UNIQUE INDEX IF NOT EXISTS staff_delegation_tenant_staff ON staff_users(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_delegation_tenant_branch ON branches(business_id,id);
CREATE TABLE IF NOT EXISTS staff_service_grants (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id),
 staff_id UUID NOT NULL,
 branch_id UUID,
 action TEXT NOT NULL CHECK(action='restore_redemption'),
 per_action_points INTEGER NOT NULL CHECK(per_action_points BETWEEN 1 AND 100000),
 total_points INTEGER NOT NULL CHECK(total_points BETWEEN 1 AND 1000000 AND total_points>=per_action_points),
 used_points INTEGER NOT NULL DEFAULT 0 CHECK(used_points>=0 AND used_points<=total_points),
 starts_at TIMESTAMPTZ NOT NULL,
 ends_at TIMESTAMPTZ NOT NULL CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '31 days'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 created_by_staff_id UUID NOT NULL,
 creation_request_id UUID NOT NULL,
 creation_payload_fingerprint TEXT NOT NULL CHECK(length(creation_payload_fingerprint)=64),
 revoked_at TIMESTAMPTZ,
 revoked_by_staff_id UUID,
 UNIQUE(business_id,id),
 UNIQUE(business_id,creation_request_id),
 FOREIGN KEY(business_id,staff_id) REFERENCES staff_users(business_id,id),
 FOREIGN KEY(business_id,branch_id) REFERENCES branches(business_id,id),
 FOREIGN KEY(business_id,created_by_staff_id) REFERENCES staff_users(business_id,id),
 FOREIGN KEY(business_id,revoked_by_staff_id) REFERENCES staff_users(business_id,id)
);
CREATE OR REPLACE FUNCTION app.protect_staff_grant_creation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.creation_request_id,NEW.creation_payload_fingerprint,NEW.created_by_staff_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.creation_request_id,OLD.creation_payload_fingerprint,OLD.created_by_staff_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Staff grant creation identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_grant_creation_identity_immutable ON staff_service_grants;
CREATE TRIGGER staff_grant_creation_identity_immutable BEFORE UPDATE ON staff_service_grants
FOR EACH ROW EXECUTE FUNCTION app.protect_staff_grant_creation_identity();
CREATE INDEX IF NOT EXISTS staff_service_grants_current ON staff_service_grants(business_id,staff_id,ends_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS staff_service_usage (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id),
 grant_id UUID,
 staff_id UUID NOT NULL,
 branch_id UUID,
 action TEXT NOT NULL CHECK(action='restore_redemption'),
 points INTEGER NOT NULL CHECK(points>0),
 request_id UUID NOT NULL,
 payload_fingerprint TEXT NOT NULL,
 remaining_points INTEGER,
 owner_bypass BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,request_id),
 FOREIGN KEY(business_id,grant_id) REFERENCES staff_service_grants(business_id,id),
 FOREIGN KEY(business_id,staff_id) REFERENCES staff_users(business_id,id),
 FOREIGN KEY(business_id,branch_id) REFERENCES branches(business_id,id),
 CHECK((owner_bypass AND grant_id IS NULL AND remaining_points IS NULL) OR (NOT owner_bypass AND grant_id IS NOT NULL AND remaining_points>=0))
);
CREATE INDEX IF NOT EXISTS staff_service_usage_history ON staff_service_usage(business_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS staff_shift_notices (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id),
 branch_id UUID,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 600),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 created_by_staff_id UUID NOT NULL,
 updated_by_staff_id UUID NOT NULL,
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,branch_id) REFERENCES branches(business_id,id),
 FOREIGN KEY(business_id,created_by_staff_id) REFERENCES staff_users(business_id,id),
 FOREIGN KEY(business_id,updated_by_staff_id) REFERENCES staff_users(business_id,id)
);
CREATE TABLE IF NOT EXISTS staff_shift_acknowledgements (
 business_id UUID NOT NULL REFERENCES businesses(id),
 notice_id UUID NOT NULL,
 staff_id UUID NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(business_id,notice_id,staff_id,version),
 FOREIGN KEY(business_id,notice_id) REFERENCES staff_shift_notices(business_id,id),
 FOREIGN KEY(business_id,staff_id) REFERENCES staff_users(business_id,id)
);
CREATE OR REPLACE FUNCTION app.reject_staff_delegation_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Staff delegation history is immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS staff_service_usage_immutable ON staff_service_usage;
CREATE TRIGGER staff_service_usage_immutable BEFORE UPDATE OR DELETE ON staff_service_usage FOR EACH ROW EXECUTE FUNCTION app.reject_staff_delegation_history_change();
DROP TRIGGER IF EXISTS staff_shift_ack_immutable ON staff_shift_acknowledgements;
CREATE TRIGGER staff_shift_ack_immutable BEFORE UPDATE OR DELETE ON staff_shift_acknowledgements FOR EACH ROW EXECUTE FUNCTION app.reject_staff_delegation_history_change();
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['staff_service_grants','staff_service_usage','staff_shift_notices','staff_shift_acknowledgements'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);
    IF t IN ('staff_service_usage','staff_shift_acknowledgements') THEN
     EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    ELSE EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO %I',t,r);
    END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
