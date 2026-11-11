CREATE TABLE IF NOT EXISTS customer_import_jobs (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id), request_id uuid NOT NULL,
 payload_hash text NOT NULL, label text NOT NULL, existing_policy text NOT NULL CHECK(existing_policy IN ('skip','reject')),
 created_by_staff_id uuid NOT NULL REFERENCES staff_users(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','cancelled','failed')),
 rows_json jsonb NOT NULL, total integer NOT NULL CHECK(total BETWEEN 1 AND 5000), processed integer NOT NULL DEFAULT 0 CHECK(processed>=0),
 imported integer NOT NULL DEFAULT 0, skipped integer NOT NULL DEFAULT 0, opening_points bigint NOT NULL DEFAULT 0,
 batch_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(batch_ids)<=50),
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', UNIQUE(business_id,request_id), CHECK(processed<=total)
);
ALTER TABLE customer_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customer_import_jobs;
CREATE POLICY tenant_isolation ON customer_import_jobs USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON customer_import_jobs FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON customer_import_jobs TO %I',r); END IF;
END LOOP; END $$;
