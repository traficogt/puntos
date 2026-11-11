-- Email is opt-in. Existing phone subscriptions and outbox rows retain their channel.
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS verified_email text;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
CREATE OR REPLACE FUNCTION app.clear_staff_email_verification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN NEW.verified_email=NULL; NEW.email_verified_at=NULL; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.clear_staff_email_verification() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_email_verification_reset ON staff_users;
CREATE TRIGGER staff_email_verification_reset BEFORE UPDATE OF email ON staff_users FOR EACH ROW EXECUTE FUNCTION app.clear_staff_email_verification();
CREATE UNIQUE INDEX IF NOT EXISTS staff_owner_email_tenant_id ON staff_users(business_id,id);
CREATE TABLE IF NOT EXISTS owner_brief_email_verifications (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL, destination text NOT NULL, token_hash text NOT NULL CHECK(length(token_hash)=64),
 status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','accepted','failed','uncertain','suppressed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,owner_id) REFERENCES staff_users(business_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS owner_brief_email_verification_limits ON owner_brief_email_verifications(business_id,owner_id,created_at);
ALTER TABLE owner_brief_email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_brief_email_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON owner_brief_email_verifications;
CREATE POLICY tenant_isolation ON owner_brief_email_verifications USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
REVOKE ALL ON owner_brief_email_verifications FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['loyalty','puntos_app','loyalty_app'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON owner_brief_email_verifications TO %I',r); END IF;
 END LOOP;
END $$;
ALTER TABLE weekly_owner_briefs ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'phone' CHECK(channel IN ('phone','email'));
ALTER TABLE weekly_owner_briefs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'weekly' CHECK(kind IN ('weekly','test'));
ALTER TABLE weekly_owner_briefs ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE weekly_owner_briefs DROP CONSTRAINT IF EXISTS weekly_owner_briefs_destination_check;
ALTER TABLE weekly_owner_briefs DROP CONSTRAINT IF EXISTS weekly_owner_briefs_destination_channel_check;
ALTER TABLE weekly_owner_briefs ADD CONSTRAINT weekly_owner_briefs_destination_channel_check CHECK((channel='phone' AND destination ~ '^[0-9]{8,15}$') OR (channel='email' AND length(destination)<=254 AND destination ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
-- Keep UNIQUE(business_id,period_start): deployed workers use that ON CONFLICT target.
-- Test requests have no scheduled week; PostgreSQL permits multiple NULLs in this key.
ALTER TABLE weekly_owner_briefs ALTER COLUMN period_start DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS weekly_owner_briefs_test_request ON weekly_owner_briefs(business_id,owner_id,request_id) WHERE kind='test';
ALTER TABLE weekly_owner_briefs DROP CONSTRAINT IF EXISTS weekly_owner_briefs_request_kind_check;
ALTER TABLE weekly_owner_briefs ADD CONSTRAINT weekly_owner_briefs_request_kind_check CHECK((kind='weekly' AND period_start IS NOT NULL AND request_id IS NULL) OR (kind='test' AND period_start IS NULL AND request_id IS NOT NULL AND channel='email'));
CREATE OR REPLACE FUNCTION app.guard_weekly_brief_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.destination,NEW.period_start,NEW.snapshot,NEW.expires_at,NEW.channel,NEW.kind,NEW.request_id) IS DISTINCT FROM ROW(OLD.destination,OLD.period_start,OLD.snapshot,OLD.expires_at,OLD.channel,OLD.kind,OLD.request_id) OR (NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN RAISE EXCEPTION 'Weekly brief terms are immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
