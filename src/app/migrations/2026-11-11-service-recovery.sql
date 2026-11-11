-- Service evidence is append-only. Restitution keeps original redemption/debit
-- and cost evidence; it is a separate ledger adjustment, never new earnings.
CREATE UNIQUE INDEX IF NOT EXISTS service_customers_tenant_id ON customers(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS service_rewards_tenant_id ON rewards(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS service_redemptions_tenant_id ON redemptions(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS service_branches_tenant_id ON branches(business_id,id);
CREATE TABLE IF NOT EXISTS service_cases (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 branch_id UUID,
 customer_id UUID NOT NULL,
 reward_id UUID,
 redemption_id UUID,
 kind TEXT NOT NULL CHECK(kind IN ('redemption_failed','unavailable','unfulfilled')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 request_id UUID NOT NULL,
 request_fingerprint TEXT NOT NULL,
 reported_by_staff_id UUID NOT NULL REFERENCES staff_users(id),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 evidence JSONB NOT NULL DEFAULT '{}',
 resolution TEXT CHECK(resolution IN ('original_fulfilled','alternative_accepted','closed_with_reason','points_restored')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 resolved_at TIMESTAMPTZ,
 UNIQUE(business_id,id), UNIQUE(business_id,request_id),
 FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id),
 FOREIGN KEY(business_id,reward_id) REFERENCES rewards(business_id,id),
 FOREIGN KEY(business_id,redemption_id) REFERENCES redemptions(business_id,id),
 FOREIGN KEY(business_id,branch_id) REFERENCES branches(business_id,id)
);
CREATE INDEX IF NOT EXISTS service_cases_queue ON service_cases(business_id,status,created_at DESC,id);
CREATE TABLE IF NOT EXISTS service_case_events (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 case_id UUID NOT NULL,
 actor_staff_id UUID NOT NULL REFERENCES staff_users(id),
 request_id UUID NOT NULL,
 request_fingerprint TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('reported','resolved')),
 version INTEGER NOT NULL CHECK(version>0),
 details JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(business_id,request_id), UNIQUE(case_id,version),
 FOREIGN KEY(business_id,case_id) REFERENCES service_cases(business_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS service_redemption_restorations (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 redemption_id UUID NOT NULL,
 case_id UUID NOT NULL,
 customer_id UUID NOT NULL,
 adjustment_id UUID NOT NULL UNIQUE REFERENCES ledger_balance_adjustments(id),
 points_restored INTEGER NOT NULL CHECK(points_restored>0),
 restored_by_staff_id UUID NOT NULL REFERENCES staff_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(business_id,redemption_id),
 FOREIGN KEY(business_id,redemption_id) REFERENCES redemptions(business_id,id),
 FOREIGN KEY(business_id,case_id) REFERENCES service_cases(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id)
);
CREATE OR REPLACE FUNCTION app.protect_service_case_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME<>'service_cases' THEN RAISE EXCEPTION 'Service evidence is immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.business_id,NEW.branch_id,NEW.customer_id,NEW.reward_id,NEW.redemption_id,NEW.kind,NEW.request_id,NEW.request_fingerprint,NEW.reported_by_staff_id,NEW.reason,NEW.evidence,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.business_id,OLD.branch_id,OLD.customer_id,OLD.reward_id,OLD.redemption_id,OLD.kind,OLD.request_id,OLD.request_fingerprint,OLD.reported_by_staff_id,OLD.reason,OLD.evidence,OLD.created_at)
 THEN RAISE EXCEPTION 'Original case evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['service_cases','service_case_events','service_redemption_restorations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('DROP TRIGGER IF EXISTS protect_service_evidence ON %I',t);
  EXECUTE format('CREATE TRIGGER protect_service_evidence BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.protect_service_case_evidence()',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON %I FROM %I',t,r);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    IF t='service_cases' THEN EXECUTE format('GRANT UPDATE ON %I TO %I',t,r); END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;

-- Adjustments are now reachable through tenant service workflows as well as
-- platform correction tools. Preserve platform authority without tenant leaks.
ALTER TABLE ledger_balance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_balance_adjustments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ledger_balance_adjustments;
CREATE POLICY tenant_isolation ON ledger_balance_adjustments
 USING(app.is_platform_admin() OR business_id=app.current_tenant())
 WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
