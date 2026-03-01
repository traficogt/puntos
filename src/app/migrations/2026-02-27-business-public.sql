-- Public, non-sensitive business directory for join flows.
-- This avoids needing broad SELECT access to businesses (which contains password_hash).
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS business_public (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  program_type TEXT NOT NULL,
  program_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill / reconcile.
INSERT INTO business_public (business_id, slug, name, category, program_type, program_json, created_at, updated_at)
SELECT id, slug, name, category, program_type, program_json, created_at, updated_at
FROM businesses
ON CONFLICT (business_id) DO UPDATE
SET slug = EXCLUDED.slug,
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    program_type = EXCLUDED.program_type,
    program_json = EXCLUDED.program_json,
    updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION app.sync_business_public()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM business_public WHERE business_id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO business_public (business_id, slug, name, category, program_type, program_json, created_at, updated_at)
  VALUES (NEW.id, NEW.slug, NEW.name, NEW.category, NEW.program_type, NEW.program_json, NEW.created_at, NEW.updated_at)
  ON CONFLICT (business_id) DO UPDATE
  SET slug = EXCLUDED.slug,
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      program_type = EXCLUDED.program_type,
      program_json = EXCLUDED.program_json,
      updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_business_public ON businesses;
CREATE TRIGGER trg_sync_business_public
AFTER INSERT OR UPDATE OR DELETE ON businesses
FOR EACH ROW EXECUTE PROCEDURE app.sync_business_public();

