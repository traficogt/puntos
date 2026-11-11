-- Native Apple/Google Wallet state is independent of the optional legacy wallet
-- extension. Source records may be deleted: retain pass tombstones so installed
-- passes can still authenticate, receive their final update, and become void.
CREATE SEQUENCE IF NOT EXISTS native_wallet_revision_seq AS bigint;

CREATE TABLE IF NOT EXISTS native_wallet_passes (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  serial_number TEXT GENERATED ALWAYS AS (id::text) STORED UNIQUE,
  membership_token TEXT NOT NULL,
  membership_hash TEXT NOT NULL UNIQUE CHECK (membership_hash ~ '^[0-9a-f]{64}$'),
  authentication_token TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  revision BIGINT NOT NULL DEFAULT nextval('native_wallet_revision_seq'),
  synced_revision BIGINT NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  lock_token UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  CHECK (revision > 0 AND synced_revision >= 0 AND synced_revision <= revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS native_wallet_active_customer_provider
  ON native_wallet_passes (business_id, customer_id, provider) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS native_wallet_customer
  ON native_wallet_passes (business_id, customer_id);
CREATE INDEX IF NOT EXISTS native_wallet_due
  ON native_wallet_passes (provider, next_attempt_at, locked_until) WHERE revision > synced_revision;

CREATE TABLE IF NOT EXISTS native_wallet_registrations (
  pass_id UUID NOT NULL,
  business_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  push_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pass_id, device_id),
  FOREIGN KEY (pass_id, business_id) REFERENCES native_wallet_passes (id, business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS native_wallet_registration_device
  ON native_wallet_registrations (device_id);
CREATE INDEX IF NOT EXISTS native_wallet_registration_push
  ON native_wallet_registrations (push_token);

ALTER TABLE native_wallet_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_wallet_passes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON native_wallet_passes;
CREATE POLICY tenant_isolation ON native_wallet_passes
  USING (app.is_platform_admin() OR business_id = app.current_tenant())
  WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());
ALTER TABLE native_wallet_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_wallet_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON native_wallet_registrations;
CREATE POLICY tenant_isolation ON native_wallet_registrations
  USING (app.is_platform_admin() OR business_id = app.current_tenant())
  WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());

-- Validate source ownership at issuance while allowing retained tombstones after
-- deletion. These invoker functions use the same tenant RLS as the mutation.
CREATE OR REPLACE FUNCTION app.native_wallet_pass_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM customers c JOIN businesses b ON b.id = c.business_id
      WHERE c.id = NEW.customer_id AND c.business_id = NEW.business_id AND c.deleted_at IS NULL
      FOR SHARE OF c, b;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Native Wallet requires an active customer in the same business' USING ERRCODE = '23503';
    END IF;
  ELSE
    IF (NEW.id, NEW.business_id, NEW.customer_id, NEW.provider, NEW.membership_token,
        NEW.membership_hash, NEW.authentication_token)
       IS DISTINCT FROM
       (OLD.id, OLD.business_id, OLD.customer_id, OLD.provider, OLD.membership_token,
        OLD.membership_hash, OLD.authentication_token) THEN
      RAISE EXCEPTION 'Native Wallet pass identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'Reissue a new native Wallet pass instead of restoring a revoked pass' USING ERRCODE = '23514';
    END IF;
    -- Allocate only after PostgreSQL has locked the tuple for this BEFORE
    -- trigger. Reserving a sequence number in UPDATE's SET expression could
    -- happen before a concurrent Apple listing acquires its shared row lock.
    IF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      NEW.revision := nextval('public.native_wallet_revision_seq');
      NEW.next_attempt_at := now();
      NEW.attempts := 0;
      NEW.updated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS native_wallet_pass_guard ON native_wallet_passes;
CREATE TRIGGER native_wallet_pass_guard BEFORE INSERT OR UPDATE ON native_wallet_passes
  FOR EACH ROW EXECUTE FUNCTION app.native_wallet_pass_guard();

CREATE OR REPLACE FUNCTION app.native_wallet_registration_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
DECLARE
  previous_push_token TEXT;
BEGIN
  -- Serialize the count with other registrations for this pass. A copied pass
  -- cannot grow an unbounded APNs fan-out, while existing devices can refresh.
  PERFORM 1 FROM native_wallet_passes WHERE id=NEW.pass_id AND business_id=NEW.business_id
    FOR UPDATE;
  SELECT push_token INTO previous_push_token FROM native_wallet_registrations
    WHERE pass_id=NEW.pass_id AND device_id=NEW.device_id;
  IF NOT FOUND AND (SELECT count(*) FROM native_wallet_registrations WHERE pass_id=NEW.pass_id) >= 20 THEN
    RAISE EXCEPTION 'Native Wallet device limit reached' USING ERRCODE = '23514', CONSTRAINT = 'native_wallet_device_limit';
  END IF;
  -- Download and installation are separate events. A worker may already have
  -- acknowledged a newer revision while this pass had no registered devices.
  -- BEFORE INSERT also runs for the registration upsert, so compare its stored
  -- token before bumping: identical retries cannot create endless push work.
  IF previous_push_token IS DISTINCT FROM NEW.push_token THEN
    UPDATE native_wallet_passes SET revision=revision+1 WHERE id=NEW.pass_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS native_wallet_registration_guard ON native_wallet_registrations;
CREATE TRIGGER native_wallet_registration_guard BEFORE INSERT ON native_wallet_registrations
  FOR EACH ROW EXECUTE FUNCTION app.native_wallet_registration_guard();

CREATE OR REPLACE FUNCTION app.native_wallet_balance_changed() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.points, NEW.pending_points, NEW.lifetime_points, NEW.tier)
      IS NOT DISTINCT FROM (OLD.points, OLD.pending_points, OLD.lifetime_points, OLD.tier) THEN
    RETURN NEW;
  END IF;
  UPDATE native_wallet_passes SET revision = revision + 1,
    next_attempt_at = now(), attempts = 0, updated_at = now()
    WHERE customer_id = COALESCE(NEW.customer_id, OLD.customer_id) AND revoked_at IS NULL;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS native_wallet_balance_changed ON customer_balances;
CREATE TRIGGER native_wallet_balance_changed AFTER INSERT OR UPDATE OR DELETE ON customer_balances
  FOR EACH ROW EXECUTE FUNCTION app.native_wallet_balance_changed();

CREATE OR REPLACE FUNCTION app.native_wallet_customer_changed() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE native_wallet_passes SET revoked_at = now()
      WHERE customer_id = OLD.id AND revoked_at IS NULL;
    RETURN OLD;
  END IF;
  IF (NEW.name, NEW.deleted_at) IS DISTINCT FROM (OLD.name, OLD.deleted_at) THEN
    UPDATE native_wallet_passes SET
      revoked_at = CASE WHEN NEW.deleted_at IS NOT NULL THEN COALESCE(revoked_at, now()) ELSE revoked_at END,
      revision = revision + 1, next_attempt_at = now(), attempts = 0, updated_at = now()
      WHERE customer_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS native_wallet_customer_changed ON customers;
CREATE TRIGGER native_wallet_customer_changed BEFORE UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION app.native_wallet_customer_changed();

CREATE OR REPLACE FUNCTION app.native_wallet_business_changed() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public, app AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE native_wallet_passes SET revoked_at = now()
      WHERE business_id = OLD.id AND revoked_at IS NULL;
    RETURN OLD;
  END IF;
  IF (NEW.name, NEW.slug, NEW.program_type, NEW.program_json, NEW.customer_branding_json)
      IS DISTINCT FROM (OLD.name, OLD.slug, OLD.program_type, OLD.program_json, OLD.customer_branding_json) THEN
    UPDATE native_wallet_passes SET revision = revision + 1,
      next_attempt_at = now(), attempts = 0, updated_at = now()
      WHERE business_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS native_wallet_business_changed ON businesses;
CREATE TRIGGER native_wallet_business_changed BEFORE UPDATE OR DELETE ON businesses
  FOR EACH ROW EXECUTE FUNCTION app.native_wallet_business_changed();
