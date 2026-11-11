CREATE TABLE IF NOT EXISTS merchant_decision_reviews (
 business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 decision_key text NOT NULL CHECK(length(decision_key) BETWEEN 1 AND 80),
 evidence_fingerprint text NOT NULL CHECK(evidence_fingerprint ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN ('reviewed','snoozed','open')),
 snoozed_until timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,decision_key),
 CHECK((status='snoozed')=(snoozed_until IS NOT NULL))
);
ALTER TABLE merchant_decision_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_decision_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON merchant_decision_reviews;
CREATE POLICY tenant_isolation ON merchant_decision_reviews USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON merchant_decision_reviews FROM PUBLIC;
DO $$ DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON merchant_decision_reviews TO %I',r);END IF;
 END LOOP;
END $$;
