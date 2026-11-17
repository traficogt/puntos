-- A customer's lifetime totals are aggregates, not single amounts: in currencies
-- such as COP they exceed numeric(10,2) (99,999,999.99) and the refresh that runs
-- with every purchase failed. Widening numeric precision does not rewrite the table.
DO $$
DECLARE col text;
BEGIN
  IF to_regclass('customer_ltv') IS NULL THEN RETURN; END IF;
  FOREACH col IN ARRAY ARRAY['total_spend','avg_transaction_value','predicted_ltv'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'customer_ltv' AND column_name = col
        AND data_type = 'numeric' AND numeric_precision IS NOT NULL
    ) THEN
      EXECUTE format('ALTER TABLE customer_ltv ALTER COLUMN %I TYPE numeric', col);
    END IF;
  END LOOP;
END $$;
