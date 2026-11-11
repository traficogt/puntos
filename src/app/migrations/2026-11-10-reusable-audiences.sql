-- Reusable definitions are live previews. Campaigns retain immutable snapshots.
CREATE TABLE IF NOT EXISTS merchant_audiences (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  definition JSONB NOT NULL CHECK(jsonb_typeof(definition)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483647),
  archived BOOLEAN NOT NULL DEFAULT false,
  created_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id,id),
  UNIQUE(business_id,request_id)
);
CREATE INDEX IF NOT EXISTS merchant_audiences_recent ON merchant_audiences(business_id,created_at DESC,id DESC);
ALTER TABLE merchant_audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_audiences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON merchant_audiences;
CREATE POLICY tenant_isolation ON merchant_audiences
  USING(app.is_platform_admin() OR business_id=app.current_tenant())
  WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON merchant_audiences FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON merchant_audiences TO %I',r);
    END IF;
  END LOOP;
END $$;
ALTER TABLE growth_campaigns ADD COLUMN IF NOT EXISTS audience_snapshot JSONB
  CHECK(audience_snapshot IS NULL OR jsonb_typeof(audience_snapshot)='object');
