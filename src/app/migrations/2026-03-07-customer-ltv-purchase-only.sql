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
    COALESCE(SUM(amount_q), 0),
    COALESCE(SUM(visits), 0),
    COUNT(*),
    AVG(amount_q),
    MIN(created_at),
    MAX(created_at),
    EXTRACT(DAY FROM (now() - MAX(created_at))),
    now()
  FROM transactions
  WHERE customer_id = NEW.customer_id
    AND type = 'PURCHASE'
    AND source <> 'reversal'
    AND status <> 'REVERSED'
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

DROP TRIGGER IF EXISTS trigger_update_customer_ltv ON transactions;
CREATE TRIGGER trigger_update_customer_ltv
AFTER INSERT OR UPDATE OF status, source, type, amount_q, visits ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_customer_ltv();
