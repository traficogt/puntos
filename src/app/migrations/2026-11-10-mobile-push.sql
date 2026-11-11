-- iPhone alert consent is independent of browser idle/absolute expiry. Explicit
-- invalidation, customer deletion, opt-out or the 30-day consent lease stop it.
CREATE TABLE IF NOT EXISTS mobile_push_devices (
  installation_id UUID PRIMARY KEY,
  secret_hash TEXT NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext TEXT NOT NULL CHECK (token_ciphertext LIKE 'enc:v2:%'),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  topic TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment='production'),
  business_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  session_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  consent_expires_at TIMESTAMPTZ NOT NULL,
  generation BIGINT NOT NULL DEFAULT 1,
  revision BIGINT NOT NULL DEFAULT 1,
  synced_revision BIGINT NOT NULL DEFAULT 1,
  points INTEGER NOT NULL DEFAULT 0,
  pending_points INTEGER NOT NULL DEFAULT 0,
  baseline_points INTEGER NOT NULL DEFAULT 0,
  baseline_pending INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  lock_token UUID,
  last_test_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (generation>0 AND revision>0 AND synced_revision>=0 AND synced_revision<=revision AND attempts>=0)
);
CREATE INDEX IF NOT EXISTS mobile_push_customer ON mobile_push_devices (business_id, customer_id);
CREATE INDEX IF NOT EXISTS mobile_push_session ON mobile_push_devices (session_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS mobile_push_due ON mobile_push_devices (next_attempt_at, locked_until) WHERE enabled AND revision>synced_revision;
ALTER TABLE mobile_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_push_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mobile_push_devices;
CREATE POLICY tenant_isolation ON mobile_push_devices
  USING (app.is_platform_admin() OR business_id=app.current_tenant())
  WITH CHECK (app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON mobile_push_devices FROM PUBLIC;

-- Auth rows intentionally have no runtime SELECT grant. Return only a bound
-- boolean; the active-registration path locks the session against logout.
CREATE OR REPLACE FUNCTION app.mobile_push_session_valid(p_id UUID, p_customer UUID, p_business UUID, p_registration BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app,pg_temp AS $$
BEGIN
  IF (app.is_platform_admin() OR p_business=app.current_tenant()) IS NOT TRUE THEN RETURN false; END IF;
  IF p_registration THEN
    PERFORM 1 FROM public.auth_sessions WHERE id=p_id AND actor_type='CUSTOMER'
      AND actor_id=p_customer AND business_id=p_business AND invalidated_at IS NULL
      AND idle_expires_at>now() AND absolute_expires_at>now() FOR SHARE;
    RETURN FOUND;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.auth_sessions WHERE id=p_id AND actor_type='CUSTOMER'
    AND actor_id=p_customer AND business_id=p_business AND invalidated_at IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION app.mobile_push_session_valid(UUID,UUID,UUID,BOOLEAN) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.mobile_push_device_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,app AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.installation_id,NEW.secret_hash) IS DISTINCT FROM (OLD.installation_id,OLD.secret_hash) THEN
    RAISE EXCEPTION 'Mobile push installation identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' OR (NEW.business_id,NEW.customer_id,NEW.session_id) IS DISTINCT FROM (OLD.business_id,OLD.customer_id,OLD.session_id)
      OR (NEW.enabled AND NOT OLD.enabled) THEN
    IF NOT EXISTS (SELECT 1 FROM customers c JOIN businesses b ON b.id=c.business_id
        WHERE c.id=NEW.customer_id AND c.business_id=NEW.business_id AND c.deleted_at IS NULL)
      OR NOT app.mobile_push_session_valid(NEW.session_id,NEW.customer_id,NEW.business_id,true) THEN
      RAISE EXCEPTION 'Mobile push requires an active customer and matching session' USING ERRCODE='23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mobile_push_device_guard ON mobile_push_devices;
CREATE TRIGGER mobile_push_device_guard BEFORE INSERT OR UPDATE ON mobile_push_devices
  FOR EACH ROW EXECUTE FUNCTION app.mobile_push_device_guard();

CREATE OR REPLACE FUNCTION app.mobile_push_balance_changed() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,app AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.points,NEW.pending_points) IS NOT DISTINCT FROM (OLD.points,OLD.pending_points) THEN RETURN NEW; END IF;
  UPDATE mobile_push_devices SET points=COALESCE(NEW.points,0),pending_points=COALESCE(NEW.pending_points,0),
    revision=revision+1,next_attempt_at=now(),attempts=0,updated_at=now()
    WHERE customer_id=COALESCE(NEW.customer_id,OLD.customer_id) AND enabled AND consent_expires_at>now();
  RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS mobile_push_balance_changed ON customer_balances;
CREATE TRIGGER mobile_push_balance_changed AFTER INSERT OR UPDATE OR DELETE ON customer_balances
  FOR EACH ROW EXECUTE FUNCTION app.mobile_push_balance_changed();

-- Source deletion and session invalidation are checked live before every claim,
-- send and acknowledgement. Do not update device rows from these source
-- mutations: financial writers lock balance -> device -> customer, so reverse
-- customer/session -> device trigger edges would introduce transaction cycles.
-- A bounded worker cleanup persists disabled tombstones without source locks.

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON mobile_push_devices TO %I',r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.mobile_push_session_valid(UUID,UUID,UUID,BOOLEAN) TO %I',r);
    END IF;
  END LOOP;
END $$;
