ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS customer_branding_json JSONB NOT NULL
  DEFAULT '{"branding_mode":"endorsed_brand","powered_by_visible":true}'::jsonb;

UPDATE businesses
SET customer_branding_json = '{"branding_mode":"endorsed_brand","powered_by_visible":true}'::jsonb
WHERE customer_branding_json IS NULL;

ALTER TABLE business_public
  ADD COLUMN IF NOT EXISTS customer_branding_json JSONB NOT NULL
  DEFAULT '{"branding_mode":"endorsed_brand","powered_by_visible":true}'::jsonb;

INSERT INTO business_public (business_id, slug, name, category, program_type, program_json, customer_branding_json, created_at, updated_at)
SELECT id, slug, name, category, program_type, program_json, customer_branding_json, created_at, updated_at
FROM businesses
ON CONFLICT (business_id) DO UPDATE
SET slug = EXCLUDED.slug,
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    program_type = EXCLUDED.program_type,
    program_json = EXCLUDED.program_json,
    customer_branding_json = EXCLUDED.customer_branding_json,
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

  INSERT INTO business_public (
    business_id,
    slug,
    name,
    category,
    program_type,
    program_json,
    customer_branding_json,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.slug,
    NEW.name,
    NEW.category,
    NEW.program_type,
    NEW.program_json,
    NEW.customer_branding_json,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (business_id) DO UPDATE
  SET slug = EXCLUDED.slug,
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      program_type = EXCLUDED.program_type,
      program_json = EXCLUDED.program_json,
      customer_branding_json = EXCLUDED.customer_branding_json,
      updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;
