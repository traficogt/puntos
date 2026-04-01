CREATE OR REPLACE FUNCTION app.security_message_log_create(
  p_id UUID,
  p_business_id UUID,
  p_customer_id UUID,
  p_channel TEXT,
  p_to_addr TEXT,
  p_body TEXT,
  p_status TEXT,
  p_provider_id TEXT,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $fn$
BEGIN
  IF COALESCE(p_channel, '') <> 'security' THEN
    RAISE EXCEPTION 'security_message_log_create only allows channel=security';
  END IF;

  INSERT INTO message_logs (id, business_id, customer_id, channel, to_addr, body, status, provider_id, error)
  VALUES (p_id, p_business_id, p_customer_id, p_channel, p_to_addr, p_body, COALESCE(p_status, 'QUEUED'), p_provider_id, p_error);
END
$fn$;

CREATE OR REPLACE FUNCTION app.security_message_log_update_status(
  p_id UUID,
  p_status TEXT,
  p_provider_id TEXT,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $fn$
BEGIN
  UPDATE message_logs
     SET status = p_status,
         provider_id = p_provider_id,
         error = p_error
   WHERE id = p_id
     AND channel = 'security';
END
$fn$;

CREATE OR REPLACE FUNCTION app.security_event_log(
  p_id UUID,
  p_event_type TEXT,
  p_severity TEXT,
  p_business_id UUID,
  p_route TEXT,
  p_method TEXT,
  p_ip TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_meta JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $fn$
BEGIN
  INSERT INTO security_events
    (id, event_type, severity, business_id, route, method, ip, actor_type, actor_id, meta)
  VALUES
    (p_id, p_event_type, COALESCE(p_severity, 'MEDIUM'), p_business_id, p_route, p_method, p_ip, p_actor_type, p_actor_id, COALESCE(p_meta, '{}'::jsonb));
END
$fn$;

REVOKE ALL ON FUNCTION app.security_message_log_create(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.security_message_log_update_status(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.security_event_log(UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty', 'puntos_app', 'loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.security_message_log_create(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.security_message_log_update_status(UUID, TEXT, TEXT, TEXT) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.security_event_log(UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) TO %I', r);
    END IF;
  END LOOP;
END$$;
