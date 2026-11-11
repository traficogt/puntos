-- Global phone proof is kept outside tenant verification records. Tenant context
-- never permits access: only the internal platform authentication flow may use it.
CREATE TABLE IF NOT EXISTS mobile_access_codes (
  id UUID PRIMARY KEY,
  phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{8,15}$'),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mobile_access_codes_phone_created ON mobile_access_codes(phone,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mobile_access_codes_active_phone ON mobile_access_codes(phone) WHERE consumed_at IS NULL;
ALTER TABLE mobile_access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_access_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_auth_only ON mobile_access_codes;
CREATE POLICY platform_auth_only ON mobile_access_codes
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
REVOKE ALL ON mobile_access_codes FROM PUBLIC;

CREATE TABLE IF NOT EXISTS mobile_access_grants (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{8,15}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mobile_access_grants_expiry ON mobile_access_grants(expires_at);
ALTER TABLE mobile_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_access_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_auth_only ON mobile_access_grants;
CREATE POLICY platform_auth_only ON mobile_access_grants
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
REVOKE ALL ON mobile_access_grants FROM PUBLIC;

CREATE INDEX IF NOT EXISTS customers_active_phone ON customers(phone) WHERE deleted_at IS NULL;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON mobile_access_codes,mobile_access_grants TO %I',r);
    END IF;
  END LOOP;
END $$;

-- Existing security log functions are the only tenantless messaging write path.
-- Permit the fixed, already-redacted phone proof message without widening access
-- to tenant OTPs, arbitrary message channels, or unmasked credentials.
CREATE OR REPLACE FUNCTION app.security_message_log_create(
  p_id UUID, p_business_id UUID, p_customer_id UUID, p_channel TEXT,
  p_to_addr TEXT, p_body TEXT, p_status TEXT, p_provider_id TEXT, p_error TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, app, pg_temp AS $fn$
BEGIN
  IF p_channel = 'verify' THEN
    IF p_business_id IS NOT NULL OR p_customer_id IS NOT NULL
      OR COALESCE(p_to_addr, '') !~ '^[0-9]{8,15}$'
      OR p_body IS DISTINCT FROM 'Tu código de PuntosFieles: ****** (expira en 10 minutos)' THEN
      RAISE EXCEPTION 'Security verification logs require masked platform phone proof';
    END IF;
  ELSIF COALESCE(p_channel, '') <> 'security' THEN
    RAISE EXCEPTION 'Security message channel is not allowed';
  END IF;
  INSERT INTO public.message_logs (id,business_id,customer_id,channel,to_addr,body,status,provider_id,error)
    VALUES (p_id,p_business_id,p_customer_id,p_channel,p_to_addr,p_body,COALESCE(p_status,'QUEUED'),p_provider_id,p_error);
END
$fn$;

CREATE OR REPLACE FUNCTION app.security_message_log_update_status(
  p_id UUID, p_status TEXT, p_provider_id TEXT, p_error TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, app, pg_temp AS $fn$
BEGIN
  UPDATE public.message_logs SET status=p_status,provider_id=p_provider_id,error=p_error
    WHERE id=p_id AND (channel='security' OR (
      channel='verify' AND business_id IS NULL AND customer_id IS NULL
      AND body='Tu código de PuntosFieles: ****** (expira en 10 minutos)'
    ));
END
$fn$;
REVOKE ALL ON FUNCTION app.security_message_log_create(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.security_message_log_update_status(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
