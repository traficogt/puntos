-- Adds the derived-state tables used by the real refund service to the isolated
-- service_recovery_test fixture. Gamification is empty, not mocked.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS program_json jsonb DEFAULT '{}';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS name text;
-- Reversal inserts take the same customer foreign-key lock as production.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='service_test_transactions_customer_fk') THEN
  ALTER TABLE transactions ADD CONSTRAINT service_test_transactions_customer_fk FOREIGN KEY(customer_id) REFERENCES customers(id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS customer_ltv(customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,total_spend numeric,total_visits int,total_transactions int,avg_transaction_value numeric,first_purchase_at timestamptz,last_purchase_at timestamptz,days_since_last_purchase int,purchase_frequency numeric,predicted_ltv numeric,churn_risk_score numeric,updated_at timestamptz);
CREATE TABLE IF NOT EXISTS visit_streaks(customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,current_streak int,longest_streak int,last_visit_date date,streak_started_at date,updated_at timestamptz);
CREATE TABLE IF NOT EXISTS referrals(id uuid PRIMARY KEY,referrer_customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,status text);
CREATE TABLE IF NOT EXISTS achievements(id uuid PRIMARY KEY,business_id uuid,name text,requirement_type text,requirement_value int,points_reward int);
CREATE TABLE IF NOT EXISTS customer_achievements(customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,achievement_id uuid,earned_at timestamptz,source_transaction_id uuid,reward_transaction_id uuid);
CREATE TABLE IF NOT EXISTS challenges(id uuid PRIMARY KEY,business_id uuid,name text,requirement_type text,requirement_value int,reward_points int,recurrence text,max_completions int);
CREATE TABLE IF NOT EXISTS customer_challenges(customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,challenge_id uuid,progress int,completed boolean,completed_at timestamptz,times_completed int,last_reset_at timestamptz,last_source_transaction_id uuid,last_reward_transaction_id uuid,completion_history jsonb,updated_at timestamptz);
