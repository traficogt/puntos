CREATE TABLE IF NOT EXISTS contact_identifiers (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, identifier_type, identifier_value)
);

CREATE INDEX IF NOT EXISTS idx_contact_identifiers_customer
  ON contact_identifiers (customer_id, created_at DESC);

DO $$
BEGIN
  IF to_regclass('contact_identifiers') IS NOT NULL THEN
    ALTER TABLE contact_identifiers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contact_identifiers FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON contact_identifiers;
    CREATE POLICY tenant_isolation ON contact_identifiers
      USING (app.is_platform_admin() OR business_id = app.current_tenant())
      WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());
  END IF;
END$$;
