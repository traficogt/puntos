-- Owner-entered public branch coordinates only. No customer location is stored.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS wallet_location_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS wallet_latitude double precision;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS wallet_longitude double precision;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='branches'::regclass AND conname='branches_wallet_location_valid') THEN
  ALTER TABLE branches ADD CONSTRAINT branches_wallet_location_valid CHECK (
   ((wallet_latitude IS NULL AND wallet_longitude IS NULL) OR
    (wallet_latitude IS NOT NULL AND wallet_longitude IS NOT NULL AND wallet_latitude BETWEEN -90 AND 90 AND wallet_longitude BETWEEN -180 AND 180))
   AND (NOT wallet_location_enabled OR(wallet_latitude IS NOT NULL AND wallet_longitude IS NOT NULL))
  );
 END IF;
END $$;
-- Time-dependent availability must refresh even without a balance mutation.
-- The default also queues existing passes once when this additive column lands.
ALTER TABLE native_wallet_passes ADD COLUMN IF NOT EXISTS content_refresh_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS native_wallet_content_refresh ON native_wallet_passes(content_refresh_at) WHERE content_refresh_at IS NOT NULL;

CREATE OR REPLACE FUNCTION app.native_wallet_engagement_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,app AS $$
DECLARE bid uuid;cid uuid;rid uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='branches' THEN
  IF TG_OP='UPDATE' AND ROW(NEW.name,NEW.wallet_location_enabled,NEW.wallet_latitude,NEW.wallet_longitude)
   IS NOT DISTINCT FROM ROW(OLD.name,OLD.wallet_location_enabled,OLD.wallet_latitude,OLD.wallet_longitude) THEN RETURN NEW;END IF;
 END IF;
 IF TG_TABLE_NAME='reward_branches' THEN
  rid:=COALESCE(NEW.reward_id,OLD.reward_id);SELECT business_id INTO bid FROM rewards WHERE id=rid;
 ELSE
  bid:=COALESCE(NEW.business_id,OLD.business_id);
  IF TG_TABLE_NAME IN('reward_promise_cycles','redemptions') THEN cid:=COALESCE(NEW.customer_id,OLD.customer_id);END IF;
  IF TG_TABLE_NAME='customer_reward_promises' THEN SELECT customer_id INTO cid FROM reward_promise_cycles WHERE id=COALESCE(NEW.cycle_id,OLD.cycle_id);END IF;
 END IF;
 UPDATE native_wallet_passes SET revision=revision+1
 WHERE business_id=bid AND (cid IS NULL OR customer_id=cid) AND revoked_at IS NULL;
 RETURN COALESCE(NEW,OLD);
END $$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['branches','rewards','reward_branches','reward_availability','reward_promise_cycles','customer_reward_promises','redemptions'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS native_wallet_engagement_changed ON %I',t);
  EXECUTE format('CREATE TRIGGER native_wallet_engagement_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.native_wallet_engagement_changed()',t);
 END LOOP;
END $$;
