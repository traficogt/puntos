-- Migration: Add branch-level scope for rewards
-- Version: v1.3.8
-- Date: 2026-02-04

CREATE TABLE IF NOT EXISTS reward_branches (
  reward_id UUID NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reward_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_reward_branches_branch ON reward_branches(branch_id);
