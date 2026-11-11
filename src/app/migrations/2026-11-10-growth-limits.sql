-- Optional gross point limits. Refunds, ledger retention and customer erasure
-- never restore availability: member snapshots preserve the granted bonus.
ALTER TABLE growth_campaigns
  ADD COLUMN IF NOT EXISTS points_budget INTEGER,
  ADD COLUMN IF NOT EXISTS points_committed INTEGER NOT NULL DEFAULT 0;

UPDATE growth_campaigns g SET points_committed=GREATEST(g.points_committed,
  COALESCE((SELECT SUM(m.bonus_points_awarded) FROM growth_campaign_members m
    WHERE m.business_id=g.business_id AND m.campaign_id=g.id),0)::integer);

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='growth_campaigns'::regclass AND conname='growth_campaigns_point_limits') THEN
    ALTER TABLE growth_campaigns ADD CONSTRAINT growth_campaigns_point_limits CHECK (
      points_committed >= 0 AND (points_budget IS NULL OR
        (points_budget BETWEEN 1 AND 2000000 AND points_budget >= bonus_points AND points_committed <= points_budget))
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.guard_growth_point_limits() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.starts_at IS NOT NULL AND NEW.points_budget IS DISTINCT FROM OLD.points_budget THEN
    RAISE EXCEPTION 'Activated campaign point budget is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.points_committed < OLD.points_committed THEN
    RAISE EXCEPTION 'Committed campaign points cannot decrease' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_growth_point_limits() FROM PUBLIC;
DROP TRIGGER IF EXISTS growth_campaigns_point_limits_guard ON growth_campaigns;
CREATE TRIGGER growth_campaigns_point_limits_guard BEFORE UPDATE ON growth_campaigns
FOR EACH ROW EXECUTE FUNCTION app.guard_growth_point_limits();
