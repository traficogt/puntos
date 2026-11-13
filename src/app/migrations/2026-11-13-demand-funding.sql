-- Explicit requests and supplier reimbursement evidence; no inferred lost sales.
CREATE UNIQUE INDEX IF NOT EXISTS demand_customers_tenant_id ON customers(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS demand_rewards_tenant_id ON rewards(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS funding_redemptions_tenant_id ON redemptions(business_id,id);
CREATE TABLE IF NOT EXISTS demand_topics (
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),topic_key text NOT NULL,
 category text NOT NULL CHECK(category IN('product','reward','availability','service','other')),
 topic text NOT NULL CHECK(length(topic) BETWEEN 3 AND 120),reward_id uuid,product_context text,
 status text NOT NULL DEFAULT 'new' CHECK(status IN('new','reviewing','planned','available','declined')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),follow_up_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,id),UNIQUE(business_id,topic_key),FOREIGN KEY(business_id,reward_id) REFERENCES rewards(business_id,id)
);
CREATE TABLE IF NOT EXISTS demand_requests (
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),topic_id uuid NOT NULL,
 customer_id uuid,staff_id uuid REFERENCES staff_users(id),source text NOT NULL CHECK(source IN('staff','customer')),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=1000),request_id uuid NOT NULL,request_fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(business_id,request_id),
 CHECK(source='staff' AND staff_id IS NOT NULL OR source='customer' AND customer_id IS NOT NULL AND staff_id IS NULL),
 FOREIGN KEY(business_id,topic_id) REFERENCES demand_topics(business_id,id),FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS demand_requests_tenant_id ON demand_requests(business_id,id);
CREATE TABLE IF NOT EXISTS demand_request_receipts (
 business_id uuid NOT NULL REFERENCES businesses(id),request_id uuid NOT NULL,demand_request_id uuid NOT NULL,request_fingerprint text NOT NULL,deduplicated boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,request_id),FOREIGN KEY(business_id,demand_request_id) REFERENCES demand_requests(business_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS demand_member_topic ON demand_requests(business_id,topic_id,customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS demand_topic_queue ON demand_topics(business_id,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS demand_events (
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),topic_id uuid NOT NULL,staff_id uuid NOT NULL REFERENCES staff_users(id),
 request_id uuid NOT NULL,request_fingerprint text NOT NULL,version integer NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,request_id),UNIQUE(topic_id,version),FOREIGN KEY(business_id,topic_id) REFERENCES demand_topics(business_id,id)
);
CREATE TABLE IF NOT EXISTS supplier_agreements (
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),supplier_name text NOT NULL CHECK(length(supplier_name) BETWEEN 2 AND 120),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 120),reward_ids uuid[] NOT NULL CHECK(cardinality(reward_ids) BETWEEN 1 AND 100),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 minor_units integer NOT NULL CHECK(minor_units IN(0,2)),unit_amount_minor bigint NOT NULL CHECK(unit_amount_minor>0 AND unit_amount_minor<=100000000),
 cap_minor bigint NOT NULL CHECK(cap_minor>=unit_amount_minor AND cap_minor<=10000000000),closed_at timestamptz,
 created_by_staff_id uuid NOT NULL REFERENCES staff_users(id),request_id uuid NOT NULL,request_fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(business_id,id),UNIQUE(business_id,request_id)
);
CREATE TABLE IF NOT EXISTS supplier_claims (
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),agreement_id uuid NOT NULL,redemption_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','submitted','approved','rejected','paid')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL,evidence jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),request_id uuid NOT NULL,request_fingerprint text NOT NULL,
 created_by_staff_id uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 paid_minor bigint,paid_at date,payment_reference text,
 CHECK((status='paid' AND paid_minor=amount_minor AND paid_at IS NOT NULL AND length(payment_reference)>=3) OR (status<>'paid' AND paid_minor IS NULL AND paid_at IS NULL AND payment_reference IS NULL)),
 UNIQUE(business_id,id),UNIQUE(business_id,request_id),UNIQUE(business_id,redemption_id),
 FOREIGN KEY(business_id,agreement_id) REFERENCES supplier_agreements(business_id,id),FOREIGN KEY(business_id,redemption_id) REFERENCES redemptions(business_id,id)
);
CREATE TABLE IF NOT EXISTS supplier_claim_events (
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),claim_id uuid NOT NULL,staff_id uuid NOT NULL REFERENCES staff_users(id),
 request_id uuid NOT NULL,request_fingerprint text NOT NULL,version integer NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,request_id),UNIQUE(claim_id,version),FOREIGN KEY(business_id,claim_id) REFERENCES supplier_claims(business_id,id)
);
CREATE INDEX IF NOT EXISTS supplier_claims_agreement ON supplier_claims(business_id,agreement_id,status);
CREATE OR REPLACE FUNCTION app.protect_demand_funding_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME IN('demand_requests','demand_request_receipts','demand_events','supplier_claim_events') THEN RAISE EXCEPTION 'Demand and funding evidence is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='supplier_claims' AND (to_jsonb(NEW)-ARRAY['status','version','updated_at','paid_minor','paid_at','payment_reference']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at','paid_minor','paid_at','payment_reference']) THEN RAISE EXCEPTION 'Claim proof is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='supplier_agreements' AND (to_jsonb(NEW)-'closed_at') IS DISTINCT FROM (to_jsonb(OLD)-'closed_at') THEN RAISE EXCEPTION 'Agreement terms are immutable; create a replacement agreement' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='demand_topics' AND (to_jsonb(NEW)-ARRAY['status','version','updated_at','follow_up_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at','follow_up_at']) THEN RAISE EXCEPTION 'Original demand topic is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;r text; BEGIN
 FOREACH t IN ARRAY ARRAY['demand_topics','demand_requests','demand_request_receipts','demand_events','supplier_agreements','supplier_claims','supplier_claim_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant())',t);
  EXECUTE format('DROP TRIGGER IF EXISTS protect_demand_funding ON %I',t);
  EXECUTE format('CREATE TRIGGER protect_demand_funding BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.protect_demand_funding_evidence()',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON %I FROM %I',t,r);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO %I',t,r);
    IF t IN('demand_topics','supplier_agreements','supplier_claims') THEN EXECUTE format('GRANT UPDATE ON %I TO %I',t,r); END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;
