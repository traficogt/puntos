-- Owner progress ("Tu progreso"): business-level milestones, owner choices and the
-- deterministic treatment/holdout variant. Design of record:
-- docs/product/2026-11-23-owner-progress.md.
--
-- Additive and backward-compatible: two new tenant tables and one nullable column
-- on businesses. Nothing reads them unless the platform setting owner_progress_mode
-- is not "off", and installed native apps never touch these tables.
CREATE TABLE IF NOT EXISTS owner_progress_milestones (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  reached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  PRIMARY KEY (business_id, key)
);
CREATE TABLE IF NOT EXISTS owner_progress_state (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  hidden BOOLEAN NOT NULL DEFAULT false,
  current_goal TEXT CHECK (current_goal IS NULL OR current_goal ~ '^[a-z0-9_]{1,40}$'),
  dismissed_goals JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dismissed_goals) = 'object'),
  last_review_at TIMESTAMPTZ,
  last_review_decision TEXT CHECK (last_review_decision IS NULL OR last_review_decision IN ('keep', 'adjust')),
  freezes_used INTEGER NOT NULL DEFAULT 0 CHECK (freezes_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((last_review_at IS NULL) = (last_review_decision IS NULL))
);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS owner_progress_variant TEXT
  CHECK (owner_progress_variant IS NULL OR owner_progress_variant IN ('treatment', 'holdout'));

DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['owner_progress_milestones','owner_progress_state'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app.is_platform_admin() OR business_id = app.current_tenant()) WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant())', t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r AND oid <> (SELECT relowner FROM pg_class WHERE oid = to_regclass(t))) THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', t, r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', t, r);
   END IF;
  END LOOP;
 END LOOP;
END $$;
