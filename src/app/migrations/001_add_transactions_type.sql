-- Migration: Add type column to transactions table
-- Version: v1.3.6
-- Date: 2026-01-29

-- Add type column to existing transactions table
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'PURCHASE';

-- Add default UUID generation if not already set
-- Note: This only works for new rows, existing rows already have UUIDs
ALTER TABLE transactions 
ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Create index on type for faster queries
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

-- Add check constraint for common transaction types (optional)
-- ALTER TABLE transactions 
-- ADD CONSTRAINT chk_transaction_type 
-- CHECK (type IN ('PURCHASE', 'REWARD', 'REFUND', 'REFERRAL_REWARD', 'ACHIEVEMENT_REWARD', 'TIER_BONUS', 'MANUAL_ADJUSTMENT'));
