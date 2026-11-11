-- An import is an administrative opening balance, never a verified enrollment.
-- Keeping the origin separately lets signup metrics exclude administrative rows.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS customer_migration_batches (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  label TEXT NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 100),
  existing_policy TEXT NOT NULL CHECK(existing_policy IN ('skip','reject')),
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 100),
  imported_count INTEGER NOT NULL CHECK(imported_count BETWEEN 0 AND 100),
  skipped_count INTEGER NOT NULL CHECK(skipped_count BETWEEN 0 AND 100),
  opening_points BIGINT NOT NULL CHECK(opening_points BETWEEN 0 AND 214748364700),
  created_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id,request_id),
  CHECK(row_count=imported_count+skipped_count)
);
CREATE INDEX IF NOT EXISTS customer_migration_batches_recent
  ON customer_migration_batches(business_id,created_at DESC,id DESC);
ALTER TABLE customer_migration_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_migration_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customer_migration_batches;
CREATE POLICY tenant_isolation ON customer_migration_batches
  USING(app.is_platform_admin() OR business_id=app.current_tenant())
  WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON customer_migration_batches FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      -- Finished batches are immutable; retries only read their original result.
      EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON customer_migration_batches FROM %I',r);
      EXECUTE format('GRANT SELECT,INSERT ON customer_migration_batches TO %I',r);
    END IF;
  END LOOP;
END $$;
