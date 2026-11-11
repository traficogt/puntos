-- Legacy monetary columns keep their API names. No conversion or relabeling of activity.
CREATE OR REPLACE FUNCTION app.protect_business_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_currency text; after_currency text;
BEGIN
  before_currency := COALESCE(OLD.program_json->'region'->>'currency','GTQ');
  -- Older installed clients can replace program_json without knowing this additive field.
  IF OLD.program_json ? 'region' AND NOT (COALESCE(NEW.program_json,'{}'::jsonb) ? 'region') THEN
    NEW.program_json := COALESCE(NEW.program_json,'{}'::jsonb)||jsonb_build_object('region',OLD.program_json->'region');
  END IF;
  IF NEW.program_json ? 'region' AND (
    jsonb_typeof(NEW.program_json->'region') IS DISTINCT FROM 'object'
    OR COALESCE(NEW.program_json->'region'->>'country','') NOT IN ('GT','MX','SV','HN','CR','PA','CO','PE','CL','DO','EC','US')
    OR COALESCE(NEW.program_json->'region'->>'currency','') NOT IN ('GTQ','MXN','USD','HNL','CRC','COP','PEN','CLP','DOP')
    OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.program_json->'region'->>'timezone' AND name LIKE '%/%')
  ) THEN RAISE EXCEPTION 'Invalid complete regional settings' USING ERRCODE='23514'; END IF;
  after_currency := COALESCE(NEW.program_json->'region'->>'currency','GTQ');
  IF after_currency NOT IN ('GTQ','MXN','USD','HNL','CRC','COP','PEN','CLP','DOP') THEN RAISE EXCEPTION 'Unsupported operating currency' USING ERRCODE='23514'; END IF;
  IF before_currency IS DISTINCT FROM after_currency AND (
    EXISTS(SELECT 1 FROM transactions WHERE business_id=OLD.id)
    OR EXISTS(SELECT 1 FROM reward_unit_costs WHERE business_id=OLD.id)
    OR EXISTS(SELECT 1 FROM hospitality_grants WHERE business_id=OLD.id)
    OR EXISTS(SELECT 1 FROM hospitality_entitlements WHERE business_id=OLD.id)
    OR EXISTS(SELECT 1 FROM gift_cards WHERE business_id=OLD.id)
    OR EXISTS(SELECT 1 FROM growth_campaigns WHERE business_id=OLD.id)
    OR EXISTS(SELECT 1 FROM pos_refund_receipts WHERE business_id=OLD.id)
    OR EXISTS(SELECT 1 FROM reward_economics_settings WHERE business_id=OLD.id)
  ) THEN RAISE EXCEPTION 'Operating currency cannot relabel monetary history' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_business_currency ON businesses;
CREATE TRIGGER protect_business_currency BEFORE UPDATE OF program_json ON businesses FOR EACH ROW EXECUTE FUNCTION app.protect_business_currency();
CREATE OR REPLACE FUNCTION app.lock_operating_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM businesses WHERE id=NEW.business_id FOR SHARE;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lock_operating_currency ON transactions;
CREATE TRIGGER lock_operating_currency BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION app.lock_operating_currency();
DROP TRIGGER IF EXISTS lock_operating_currency ON reward_unit_costs;
CREATE TRIGGER lock_operating_currency BEFORE INSERT OR UPDATE ON reward_unit_costs FOR EACH ROW EXECUTE FUNCTION app.lock_operating_currency();
ALTER TABLE pos_refund_receipts DROP CONSTRAINT IF EXISTS pos_refund_receipts_currency_check;
ALTER TABLE pos_refund_receipts ADD CONSTRAINT pos_refund_receipts_currency_check CHECK(currency IN ('GTQ','MXN','USD','HNL','CRC','COP','PEN','CLP','DOP'));

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['gift_cards','growth_campaigns','pos_refund_receipts','reward_economics_settings'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS lock_operating_currency ON %I',t);
 EXECUTE format('CREATE TRIGGER lock_operating_currency BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app.lock_operating_currency()',t);
 END LOOP;
END $$;
