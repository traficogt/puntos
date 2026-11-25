-- Phone proof for the self-serve signup (design section 3.2). The one-time code
-- itself reuses mobile_access_codes; this sibling grant table keeps a verified
-- signup phone separate from mobile_access_grants so a customer-card grant can
-- never be replayed as a signup grant. Platform authentication context only.
CREATE TABLE IF NOT EXISTS trial_phone_grants (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{8,15}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS trial_phone_grants_expiry ON trial_phone_grants(expires_at);
ALTER TABLE trial_phone_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_phone_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_auth_only ON trial_phone_grants;
CREATE POLICY platform_auth_only ON trial_phone_grants
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
REVOKE ALL ON trial_phone_grants FROM PUBLIC;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON trial_phone_grants TO %I', r);
    END IF;
  END LOOP;
END $$;
