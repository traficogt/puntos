-- EXTENSIONS

-- Enable UUID generation functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- TIERED LOYALTY SYSTEM

-- Loyalty tiers configuration
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL, -- e.g., "Bronze", "Silver", "Gold"
  tier_level INTEGER NOT NULL, -- 1, 2, 3, etc. (higher = better)
  min_points INTEGER NOT NULL DEFAULT 0, -- Minimum points to reach tier
  min_spend DECIMAL(10,2), -- Alternative: minimum spend
  min_visits INTEGER, -- Alternative: minimum visits
  points_multiplier DECIMAL(4,2) DEFAULT 1.0, -- e.g., 1.5x points for Gold
  perks JSONB DEFAULT '[]', -- Array of perk descriptions
  color VARCHAR(7), -- Hex color for UI
  icon_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, tier_level)
);

CREATE INDEX idx_loyalty_tiers_business ON loyalty_tiers(business_id);

-- Customer tier assignments
CREATE TABLE IF NOT EXISTS customer_tiers (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  tier_id UUID REFERENCES loyalty_tiers(id) ON DELETE SET NULL,
  achieved_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customer_tiers_tier ON customer_tiers(tier_id);

-- Tier history for analytics
CREATE TABLE IF NOT EXISTS tier_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  from_tier_id UUID REFERENCES loyalty_tiers(id) ON DELETE SET NULL,
  to_tier_id UUID NOT NULL REFERENCES loyalty_tiers(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ DEFAULT now(),
  reason VARCHAR(50) -- 'points', 'spend', 'visits', 'manual'
);

CREATE INDEX idx_tier_history_customer ON tier_history(customer_id);
CREATE INDEX idx_tier_history_date ON tier_history(changed_at);

-- REFERRAL PROGRAM

-- Referral codes
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  referrer_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL UNIQUE,
  uses_count INTEGER DEFAULT 0,
  max_uses INTEGER, -- NULL = unlimited
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, referrer_customer_id)
);

CREATE INDEX idx_referral_codes_business ON referral_codes(business_id);
CREATE INDEX idx_referral_codes_referrer ON referral_codes(referrer_customer_id);
CREATE INDEX idx_referral_codes_code ON referral_codes(code);

-- Referral tracking
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  referral_code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
  referrer_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  referred_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  referrer_reward_points INTEGER,
  referred_reward_points INTEGER,
  referrer_rewarded_at TIMESTAMPTZ,
  referred_rewarded_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'rewarded'
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ, -- When referred made first purchase
  UNIQUE(referred_customer_id) -- Each customer can only be referred once
);

CREATE INDEX idx_referrals_business ON referrals(business_id);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_customer_id);
CREATE INDEX idx_referrals_referred ON referrals(referred_customer_id);
CREATE INDEX idx_referrals_status ON referrals(status);

-- Referral program settings
CREATE TABLE IF NOT EXISTS referral_settings (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  referrer_reward_points INTEGER DEFAULT 100,
  referred_reward_points INTEGER DEFAULT 50,
  min_purchase_to_complete DECIMAL(10,2), -- Referred must spend X to complete
  reward_on_signup BOOLEAN DEFAULT false, -- Reward immediately or after first purchase
  custom_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- GAMIFICATION SYSTEM

-- Achievement/badge definitions
CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon_url TEXT,
  badge_image_url TEXT,
  requirement_type VARCHAR(50) NOT NULL, -- 'points', 'visits', 'spend', 'referrals', 'streak', 'custom'
  requirement_value INTEGER,
  requirement_config JSONB, -- For complex requirements
  points_reward INTEGER DEFAULT 0,
  tier_boost INTEGER DEFAULT 0, -- Bonus towards tier progress
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_achievements_business ON achievements(business_id);
CREATE INDEX idx_achievements_type ON achievements(requirement_type);

-- Customer achievements (earned badges)
CREATE TABLE IF NOT EXISTS customer_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ DEFAULT now(),
  progress INTEGER DEFAULT 100, -- Percentage of completion (for display)
  UNIQUE(customer_id, achievement_id)
);

CREATE INDEX idx_customer_achievements_customer ON customer_achievements(customer_id);
CREATE INDEX idx_customer_achievements_achievement ON customer_achievements(achievement_id);

-- Challenges/missions
CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  challenge_type VARCHAR(50) NOT NULL, -- 'limited_time', 'recurring', 'personal'
  requirement_type VARCHAR(50) NOT NULL, -- 'visits', 'spend', 'items', 'referrals'
  requirement_value INTEGER NOT NULL,
  reward_points INTEGER NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  recurrence VARCHAR(20), -- NULL, 'daily', 'weekly', 'monthly'
  max_completions INTEGER, -- NULL = unlimited
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_challenges_business ON challenges(business_id);
CREATE INDEX idx_challenges_dates ON challenges(start_date, end_date);
CREATE INDEX idx_challenges_active ON challenges(active) WHERE active = true;

-- Customer challenge progress
CREATE TABLE IF NOT EXISTS customer_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  progress INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  times_completed INTEGER DEFAULT 0,
  last_reset_at TIMESTAMPTZ, -- For recurring challenges
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id, challenge_id)
);

CREATE INDEX idx_customer_challenges_customer ON customer_challenges(customer_id);
CREATE INDEX idx_customer_challenges_challenge ON customer_challenges(challenge_id);
CREATE INDEX idx_customer_challenges_completed ON customer_challenges(completed);

-- Visit streaks tracking
CREATE TABLE IF NOT EXISTS visit_streaks (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_visit_date DATE,
  streak_started_at DATE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ENHANCED ANALYTICS

-- Customer segments
CREATE TABLE IF NOT EXISTS customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  segment_type VARCHAR(50), -- 'rfm', 'tier', 'behavior', 'manual'
  criteria JSONB NOT NULL, -- Flexible criteria storage
  auto_update BOOLEAN DEFAULT true,
  color VARCHAR(7),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customer_segments_business ON customer_segments(business_id);

-- Customer segment assignments
CREATE TABLE IF NOT EXISTS customer_segment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES customer_segments(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  auto_assigned BOOLEAN DEFAULT true,
  UNIQUE(customer_id, segment_id)
);

CREATE INDEX idx_segment_assignments_customer ON customer_segment_assignments(customer_id);
CREATE INDEX idx_segment_assignments_segment ON customer_segment_assignments(segment_id);

-- Customer lifetime value tracking
CREATE TABLE IF NOT EXISTS customer_ltv (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  total_spend DECIMAL(10,2) DEFAULT 0,
  total_visits INTEGER DEFAULT 0,
  total_transactions INTEGER DEFAULT 0,
  avg_transaction_value DECIMAL(10,2) DEFAULT 0,
  first_purchase_at TIMESTAMPTZ,
  last_purchase_at TIMESTAMPTZ,
  days_since_last_purchase INTEGER,
  purchase_frequency DECIMAL(8,2), -- Purchases per month
  predicted_ltv DECIMAL(10,2), -- ML prediction (future feature)
  churn_risk_score DECIMAL(4,2), -- 0-1, higher = more risk
  rfm_recency INTEGER, -- 1-5 score
  rfm_frequency INTEGER, -- 1-5 score
  rfm_monetary INTEGER, -- 1-5 score
  rfm_score INTEGER, -- Combined RFM
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customer_ltv_spend ON customer_ltv(total_spend DESC);
CREATE INDEX idx_customer_ltv_churn ON customer_ltv(churn_risk_score DESC);
CREATE INDEX idx_customer_ltv_rfm ON customer_ltv(rfm_score DESC);

-- Cohort analysis data
CREATE TABLE IF NOT EXISTS customer_cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  cohort_name VARCHAR(100) NOT NULL, -- e.g., "2024-01" for January 2024
  cohort_date DATE NOT NULL, -- First day of cohort period
  cohort_type VARCHAR(20) NOT NULL, -- 'monthly', 'weekly', 'quarterly'
  customer_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, cohort_date, cohort_type)
);

CREATE INDEX idx_cohorts_business ON customer_cohorts(business_id);
CREATE INDEX idx_cohorts_date ON customer_cohorts(cohort_date);

-- Customer cohort assignments
CREATE TABLE IF NOT EXISTS customer_cohort_assignments (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  cohort_id UUID NOT NULL REFERENCES customer_cohorts(id) ON DELETE CASCADE,
  PRIMARY KEY (customer_id, cohort_id)
);

CREATE INDEX idx_cohort_assignments_cohort ON customer_cohort_assignments(cohort_id);

-- MOBILE WALLET (Foundation)

-- Wallet passes (Apple Wallet / Google Pay)
CREATE TABLE IF NOT EXISTS wallet_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  pass_type VARCHAR(20) NOT NULL, -- 'apple', 'google'
  pass_type_identifier VARCHAR(255), -- Apple: pass type ID, Google: class ID
  serial_number VARCHAR(100) NOT NULL,
  authentication_token VARCHAR(100) NOT NULL,
  pass_data JSONB, -- Full pass configuration
  last_updated TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id, pass_type)
);

CREATE INDEX idx_wallet_passes_customer ON wallet_passes(customer_id);
CREATE INDEX idx_wallet_passes_serial ON wallet_passes(serial_number);

-- Wallet pass update log
CREATE TABLE IF NOT EXISTS wallet_pass_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id UUID NOT NULL REFERENCES wallet_passes(id) ON DELETE CASCADE,
  update_type VARCHAR(50) NOT NULL, -- 'points_change', 'tier_change', 'reward_redeemed'
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pass_updates_pass ON wallet_pass_updates(pass_id);
CREATE INDEX idx_pass_updates_date ON wallet_pass_updates(created_at);

-- TRIGGERS & FUNCTIONS

-- Function to update tier based on points
CREATE OR REPLACE FUNCTION check_tier_progression()
RETURNS TRIGGER AS $$
DECLARE
  new_tier_id UUID;
  current_tier_level INTEGER;
  business UUID;
BEGIN
  -- Get customer's business
  SELECT c.business_id INTO business
  FROM customers c
  WHERE c.id = NEW.customer_id;
  
  -- Get current tier level
  SELECT COALESCE(lt.tier_level, 0) INTO current_tier_level
  FROM customer_tiers ct
  LEFT JOIN loyalty_tiers lt ON ct.tier_id = lt.id
  WHERE ct.customer_id = NEW.customer_id;
  
  -- Find highest tier customer qualifies for
  SELECT lt.id INTO new_tier_id
  FROM loyalty_tiers lt
  WHERE lt.business_id = business
    AND lt.active = true
    AND NEW.points >= lt.min_points
    AND lt.tier_level > COALESCE(current_tier_level, 0)
  ORDER BY lt.tier_level DESC
  LIMIT 1;
  
  -- Update tier if found
  IF new_tier_id IS NOT NULL THEN
    INSERT INTO customer_tiers (customer_id, tier_id)
    VALUES (NEW.customer_id, new_tier_id)
    ON CONFLICT (customer_id)
    DO UPDATE SET 
      tier_id = new_tier_id,
      updated_at = now();
    
    -- Log tier change
    INSERT INTO tier_history (customer_id, to_tier_id, reason)
    VALUES (NEW.customer_id, new_tier_id, 'points');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on points update
DROP TRIGGER IF EXISTS trigger_check_tier_progression ON customer_balances;
CREATE TRIGGER trigger_check_tier_progression
AFTER INSERT OR UPDATE OF points ON customer_balances
FOR EACH ROW
EXECUTE FUNCTION check_tier_progression();

-- Function to update customer LTV
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
  ON CONFLICT (customer_id)
  DO UPDATE SET
    total_spend = EXCLUDED.total_spend,
    total_visits = EXCLUDED.total_visits,
    total_transactions = EXCLUDED.total_transactions,
    avg_transaction_value = EXCLUDED.avg_transaction_value,
    last_purchase_at = EXCLUDED.last_purchase_at,
    days_since_last_purchase = EXCLUDED.days_since_last_purchase,
    updated_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on transaction insert
DROP TRIGGER IF EXISTS trigger_update_customer_ltv ON transactions;
CREATE TRIGGER trigger_update_customer_ltv
AFTER INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_customer_ltv();

-- Function to update visit streaks
CREATE OR REPLACE FUNCTION update_visit_streak()
RETURNS TRIGGER AS $$
DECLARE
  last_visit DATE;
  current_streak_val INTEGER;
BEGIN
  IF NEW.visits IS NULL OR NEW.visits = 0 THEN
    RETURN NEW;
  END IF;
  
  SELECT last_visit_date, current_streak
  INTO last_visit, current_streak_val
  FROM visit_streaks
  WHERE customer_id = NEW.customer_id;
  
  IF last_visit IS NULL THEN
    -- First visit
    INSERT INTO visit_streaks (customer_id, current_streak, longest_streak, last_visit_date, streak_started_at)
    VALUES (NEW.customer_id, 1, 1, CURRENT_DATE, CURRENT_DATE);
  ELSIF last_visit = CURRENT_DATE THEN
    -- Same day, no change
    NULL;
  ELSIF last_visit = CURRENT_DATE - INTERVAL '1 day' THEN
    -- Consecutive day, increment streak
    UPDATE visit_streaks
    SET 
      current_streak = current_streak + 1,
      longest_streak = GREATEST(longest_streak, current_streak + 1),
      last_visit_date = CURRENT_DATE,
      updated_at = now()
    WHERE customer_id = NEW.customer_id;
  ELSE
    -- Streak broken, reset
    UPDATE visit_streaks
    SET 
      current_streak = 1,
      last_visit_date = CURRENT_DATE,
      streak_started_at = CURRENT_DATE,
      updated_at = now()
    WHERE customer_id = NEW.customer_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on transaction insert
DROP TRIGGER IF EXISTS trigger_update_visit_streak ON transactions;
CREATE TRIGGER trigger_update_visit_streak
AFTER INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_visit_streak();

COMMENT ON TABLE loyalty_tiers IS 'Loyalty tier definitions (Bronze, Silver, Gold, etc.)';
COMMENT ON TABLE customer_tiers IS 'Current tier assignment for each customer';
COMMENT ON TABLE referral_codes IS 'Unique referral codes for customers';
COMMENT ON TABLE referrals IS 'Tracking of referral relationships and rewards';
COMMENT ON TABLE achievements IS 'Gamification badges and achievements';
COMMENT ON TABLE challenges IS 'Time-limited or recurring challenges';
COMMENT ON TABLE customer_segments IS 'Customer segmentation definitions';
COMMENT ON TABLE customer_ltv IS 'Customer lifetime value and RFM scores';
COMMENT ON TABLE wallet_passes IS 'Mobile wallet pass data for Apple/Google Pay';
