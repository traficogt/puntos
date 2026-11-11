-- Anonymous visits retain no IP, user agent, phone, or browser identifiers.
-- Stable source codes are never edited or recycled; only token hashes are stored.
CREATE UNIQUE INDEX IF NOT EXISTS customers_acquisition_business_id ON customers(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS branches_acquisition_business_id ON branches(business_id,id);
CREATE TABLE IF NOT EXISTS acquisition_sources (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 request_id UUID NOT NULL,
 code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{16}$'),
 name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 branch_id UUID,
 visits BIGINT NOT NULL DEFAULT 0 CHECK (visits>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,id), UNIQUE(business_id,request_id),
 FOREIGN KEY (business_id,branch_id) REFERENCES branches(business_id,id) ON DELETE SET NULL (branch_id)
);
CREATE INDEX IF NOT EXISTS acquisition_sources_business_created ON acquisition_sources(business_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS acquisition_visits (
 token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 source_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp()+interval '30 minutes'),
 FOREIGN KEY (business_id,source_id) REFERENCES acquisition_sources(business_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS acquisition_visits_expiry ON acquisition_visits(business_id,expires_at);
CREATE TABLE IF NOT EXISTS acquisition_attributions (
 id UUID PRIMARY KEY,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 source_id UUID NOT NULL,
 customer_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,customer_id),
 FOREIGN KEY (business_id,source_id) REFERENCES acquisition_sources(business_id,id) ON DELETE CASCADE,
 FOREIGN KEY (business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE SET NULL (customer_id)
);
CREATE INDEX IF NOT EXISTS acquisition_attributions_source ON acquisition_attributions(business_id,source_id);
ALTER TABLE acquisition_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE acquisition_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE acquisition_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE acquisition_visits FORCE ROW LEVEL SECURITY;
ALTER TABLE acquisition_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE acquisition_attributions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON acquisition_sources;
CREATE POLICY tenant_isolation ON acquisition_sources USING (app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant());
DROP POLICY IF EXISTS tenant_isolation ON acquisition_visits;
CREATE POLICY tenant_isolation ON acquisition_visits USING (app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant());
DROP POLICY IF EXISTS tenant_isolation ON acquisition_attributions;
CREATE POLICY tenant_isolation ON acquisition_attributions USING (app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON acquisition_sources,acquisition_visits,acquisition_attributions FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON acquisition_sources TO %I',r);
   EXECUTE format('GRANT SELECT,INSERT,DELETE ON acquisition_visits TO %I',r);
   EXECUTE format('GRANT SELECT,INSERT ON acquisition_attributions TO %I',r);
  END IF;
 END LOOP;
END $$;
