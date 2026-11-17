-- Tier upgrades follow earned points, never the spendable balance.
-- Lifetime programs compare tier thresholds with lifetime_points. Rolling-window
-- programs are evaluated by the application and the nightly retention sweep,
-- which share one rolling earned-points definition, so this trigger leaves them
-- unchanged. Upgrades only; downgrades remain the retention sweep's decision.
CREATE OR REPLACE FUNCTION check_tier_progression()
RETURNS TRIGGER AS $$
DECLARE
  business UUID;
  tier_mode TEXT;
  current_tier UUID;
  current_tier_level INTEGER;
  new_tier_id UUID;
BEGIN
  SELECT c.business_id, COALESCE(b.program_json->'tier_policy'->>'mode', 'lifetime')
    INTO business, tier_mode
  FROM customers c
  JOIN businesses b ON b.id = c.business_id
  WHERE c.id = NEW.customer_id;

  IF business IS NULL OR tier_mode = 'rolling_days' THEN
    RETURN NEW;
  END IF;

  SELECT ct.tier_id, COALESCE(lt.tier_level, 0)
    INTO current_tier, current_tier_level
  FROM customer_tiers ct
  LEFT JOIN loyalty_tiers lt ON ct.tier_id = lt.id
  WHERE ct.customer_id = NEW.customer_id;

  SELECT lt.id INTO new_tier_id
  FROM loyalty_tiers lt
  WHERE lt.business_id = business
    AND lt.active = true
    AND NEW.lifetime_points >= lt.min_points
    AND lt.tier_level > COALESCE(current_tier_level, 0)
  ORDER BY lt.tier_level DESC
  LIMIT 1;

  IF new_tier_id IS NOT NULL THEN
    INSERT INTO customer_tiers (customer_id, tier_id)
    VALUES (NEW.customer_id, new_tier_id)
    ON CONFLICT (customer_id)
    DO UPDATE SET
      tier_id = new_tier_id,
      updated_at = now();

    INSERT INTO tier_history (customer_id, from_tier_id, to_tier_id, reason)
    VALUES (NEW.customer_id, current_tier, new_tier_id, 'points');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger only where the tier extension installed it. Spendable
-- point changes (redemptions, expiries) no longer evaluate tiers.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_check_tier_progression'
      AND tgrelid = 'customer_balances'::regclass
      AND NOT tgisinternal
  ) THEN
    DROP TRIGGER trigger_check_tier_progression ON customer_balances;
    CREATE TRIGGER trigger_check_tier_progression
      AFTER INSERT OR UPDATE OF lifetime_points ON customer_balances
      FOR EACH ROW
      EXECUTE FUNCTION check_tier_progression();
  END IF;
END $$;
