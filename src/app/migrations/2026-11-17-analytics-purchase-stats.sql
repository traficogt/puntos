-- Customer value statistics count recorded sales only. The predicate below is
-- reportingPurchase('t') from src/app/services/reporting-purchase.js: expiry,
-- bonus, redemption, migration and reversal rows and refunded sales are not
-- purchases, so they no longer move last_purchase_at, spend or averages.
-- Existing rows are corrected by src/scripts/recompute-customer-purchase-stats.mjs
-- (an operator step), not by this migration.
CREATE OR REPLACE FUNCTION update_customer_ltv()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO customer_ltv (
    customer_id,
    total_spend,
    total_visits,
    total_transactions,
    avg_transaction_value,
    first_purchase_at,
    last_purchase_at,
    days_since_last_purchase,
    updated_at
  )
  SELECT
    NEW.customer_id,
    ROUND(COALESCE(SUM(t.amount_q), 0), 2),
    COALESCE(SUM(t.visits), 0),
    COUNT(*),
    ROUND(AVG(t.amount_q), 2),
    MIN(t.created_at),
    MAX(t.created_at),
    EXTRACT(DAY FROM (now() - MAX(t.created_at))),
    now()
  FROM transactions t
  WHERE t.customer_id = NEW.customer_id
    AND (t.source IN ('online', 'offline', 'external', 'order')
    AND (t.type = 'PURCHASE' OR t.type IS NULL)
    AND t.status IN ('POSTED', 'PENDING', 'EXPIRED')
    AND (t.amount_q > 0 OR t.visits > 0 OR t.items > 0)
    AND t.original_transaction_id IS NULL
    AND t.reversed_transaction_id IS NULL)
  ON CONFLICT (customer_id)
  DO UPDATE SET
    total_spend = EXCLUDED.total_spend,
    total_visits = EXCLUDED.total_visits,
    total_transactions = EXCLUDED.total_transactions,
    avg_transaction_value = EXCLUDED.avg_transaction_value,
    first_purchase_at = EXCLUDED.first_purchase_at,
    last_purchase_at = EXCLUDED.last_purchase_at,
    days_since_last_purchase = EXCLUDED.days_since_last_purchase,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recompute when any column of the purchase definition changes. CREATE OR
-- REPLACE TRIGGER avoids the exclusive lock of dropping a trigger on a live table.
CREATE OR REPLACE TRIGGER trigger_update_customer_ltv
AFTER INSERT OR UPDATE OF status, source, type, amount_q, visits, items, original_transaction_id, reversed_transaction_id
ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_customer_ltv();

-- Cohort recalculation rebuilds memberships, so it updates cohort sizes and
-- removes stale cohorts and assignments (derived analytics data only).
DO $$
DECLARE
  r text;
BEGIN
  IF to_regclass('public.customer_cohorts') IS NULL OR to_regclass('public.customer_cohort_assignments') IS NULL THEN
    RETURN;
  END IF;
  FOREACH r IN ARRAY ARRAY['loyalty', 'puntos_app', 'loyalty_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT UPDATE, DELETE ON TABLE public.customer_cohorts TO %I', r);
      EXECUTE format('GRANT DELETE ON TABLE public.customer_cohort_assignments TO %I', r);
    END IF;
  END LOOP;
END $$;
