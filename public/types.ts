export interface AdminSignupPayload {
  businessName: string;
  email: string;
  phone?: string;
  password: string;
  category: string;
  program_type: "SPEND" | "VISIT" | "ITEM";
  program_json: Record<string, unknown>;
}

export interface AdminSignupResponse {
  business: {
    slug: string;
  };
}

export interface CustomerAchievement {
  icon_url?: string;
  name?: string;
  description?: string;
  earned_at?: string;
  progress?: number;
  current?: number;
  total?: number;
}

export interface CustomerAchievementsResponse {
  earned?: CustomerAchievement[];
  inProgress?: CustomerAchievement[];
}

export interface CustomerCardBusiness {
  name?: string;
}

export interface CustomerCardProfile {
  id?: string;
  name?: string;
  phone?: string;
  points?: number;
  pending_points?: number;
  lifetime_points?: number;
  last_visit_at?: string;
}

export interface CustomerMeResponse {
  business?: CustomerCardBusiness;
  customer?: CustomerCardProfile;
}

export interface CustomerReward {
  id?: string;
  name?: string;
  description?: string;
  points_cost: number;
}

export interface CustomerRewardsResponse {
  rewards?: CustomerReward[];
}

export interface CustomerTransaction {
  created_at: string;
  points_delta: number;
  amount_q?: number | null;
}

export interface CustomerRedemption {
  created_at: string;
  redeemed_at?: string | null;
  reward_name?: string;
  points_cost?: number;
  code?: string;
}

export interface CustomerHistoryResponse {
  transactions?: CustomerTransaction[];
  redemptions?: CustomerRedemption[];
}

export interface CustomerTier {
  tier_level?: number;
  name?: string;
  points_multiplier?: number;
  points_to_next_tier?: number;
  next_tier_name?: string;
  current_points?: number;
  next_tier_points?: number;
  perks?: string[];
}

export interface CustomerTierResponse {
  tier?: CustomerTier | null;
}

export interface CustomerReferralCodeData {
  code?: string;
}

export interface CustomerReferralCodeResponse {
  referral_code?: CustomerReferralCodeData | null;
}

export interface CustomerReferralStats {
  total_referrals?: number;
  completed_referrals?: number;
  total_points_earned?: number;
}
