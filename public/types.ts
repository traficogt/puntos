export interface AdminSignupPayload {
  businessName: string;
  email: string;
  phone?: string;
  password: string;
  category: string;
  program_type: "SPEND" | "VISIT" | "ITEM";
  program_json: Record<string, unknown>;
  captcha_token?: string;
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
  region?: {
    country: string;
    currency: string;
    timezone: string;
    locale: string;
    minorUnits: number;
  };
  id?: string;
  name?: string;
  slug?: string;
  plan?: string;
  features?: {
    customer_export?: boolean;
    referrals?: boolean;
    gamification?: boolean;
    tiers?: boolean;
  };
  customer_branding?: {
    branding_mode?: "platform_led" | "endorsed_brand" | "white_label_ready";
    customer_program_name?: string;
    customer_logo_url?: string;
    qr_logo_enabled?: boolean;
    primary_color?: string;
    accent_color?: string;
    neutral_theme?: "warm" | "neutral" | "cool";
    powered_by_visible?: boolean;
    wallet_headline?: string;
    join_headline?: string;
  } | null;
  member_discount?: { percent_off?: number } | null;
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
  wallet?: {
    kind: string;
    balance_q: number;
    percent?: number | null;
    bonus_percent?: number | null;
  } | null;
  stamp_card?: {
    stamps_required?: number;
    head_start?: number;
    filled?: number;
    complete?: boolean;
    reward_label?: string;
    remaining?: number;
  } | null;
}

export interface CustomerRewardInventoryBranch {
  branchId: string | null;
  branchName?: string | null;
  state: string;
  observedAt?: string | null;
  freshUntil?: string | null;
}

export interface CustomerRewardInventory {
  state: string;
  required: boolean;
  branches: CustomerRewardInventoryBranch[];
}

export interface CustomerReward {
  id?: string;
  name?: string;
  description?: string;
  points_cost: number;
  available?: boolean;
  active?: boolean;
  protected?: boolean;
  stock?: number | null;
  valid_until?: string | null;
  branch_ids?: string[];
  branch_labels?: string[];
  inventory?: CustomerRewardInventory;
}

export interface CustomerRewardProgress {
  available_points: number;
  pending_points: number;
  as_of: string;
  reward: {
    id: string;
    name: string;
    points_cost: number;
    remaining_points: number;
    status: string;
    protected: boolean;
    branch_ids: string[];
    valid_until: string | null;
  } | null;
  choices: CustomerReward[];
  earning: string | null;
  conditions: string | null;
  next_refresh_at: string | null;
}

export interface CustomerRewardsResponse {
  rewards?: CustomerReward[];
  progress?: CustomerRewardProgress;
}

export interface CustomerTransaction {
  created_at: string;
  points_delta: number;
  amount_q?: number | null;
  provenance?: {
    kind:
      | "purchase"
      | "referral_bonus"
      | "achievement_bonus"
      | "challenge_bonus"
      | "birthday_bonus"
      | "other_bonus"
      | "redemption"
      | "expiry"
      | "adjustment"
      | "reversal"
      | "opening_balance"
      | "unknown";
    status: "POSTED" | "PENDING" | "REVERSED" | "EXPIRED" | "UNKNOWN";
    includes_bonus: boolean;
  };
}

export interface CustomerRedemption {
  created_at: string;
  redeemed_at?: string | null;
  reward_name?: string;
  points_cost?: number;
  code?: string;
  status?: string;
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

/** `api()` from /lib.js as the customer wallet modules receive it. */
export type CustomerApiFn = (
  path: string,
  opts?: RequestInit & { rawError?: boolean },
) => Promise<any>;
/** Wallet markup is HTML, so the shared query helper resolves to HTMLElements. */
export type CustomerQueryFn = (selector: string) => HTMLElement | null;
export type CustomerToastFn = (message: string) => void;
/** An `api()` failure: an Error carrying the HTTP status and the server's stable code. */
export type CustomerApiError = Error & { status?: number; code?: string };

export interface CustomerPageDependencies {
  api: CustomerApiFn;
  $: CustomerQueryFn;
  toast: CustomerToastFn;
  mountIosInstallHint: () => void;
  modalAlert: (message: string, opts?: Record<string, unknown>) => Promise<unknown>;
}

/** Remembered card owner; the slug routes a re-login back to the business. */
export interface CustomerIdentity {
  businessId: string;
  customerId: string;
  slug: string;
}
export type CustomerIdentityScope = Pick<CustomerIdentity, "businessId" | "customerId">;

export type CustomerLoadStatus = "live" | "partial" | "offline" | "auth" | "superseded" | "error";
export interface CustomerLoadResult {
  status: CustomerLoadStatus;
}

/** The subset of an HTMLElement the native-wallet panel drives; unit tests supply plain stand-ins. */
export interface NativeWalletControl {
  /** lib.dom widens HTMLElement.hidden to `string | boolean` for the "until-found" state. */
  hidden: boolean | string;
  disabled?: boolean;
  textContent: string | null;
  dataset: Record<string, string | undefined>;
  onclick: ((event: PointerEvent) => unknown) | null;
  classList: { toggle(token: string, force?: boolean): unknown };
  setAttribute(name: string, value: string): void;
  focus(): void;
}

/** `/api/customer/wallet`: which native passes can be issued and whether any already exist. */
export interface CustomerNativeWalletStatus {
  providers?: { apple?: boolean; google?: boolean };
  passes?: unknown[];
}

/** Protected earning cycle from `/api/customer/reward-entitlements` (fields the wallet reads). */
export interface CustomerProtectedCycle {
  program_type: string;
  earning_terms: { points_per_q?: number; points_per_visit?: number; points_per_item?: number };
  observed_at: string;
}
export interface CustomerRewardAlternative {
  id: string;
  name: string;
  stock?: number | null;
}
export interface CustomerPromisedReward {
  id: string;
  reward_id: string;
  reward_name: string;
  description?: string | null;
  points_cost: number;
  valid_until?: string | null;
  effective_valid_until?: string | null;
  available?: boolean;
  stock?: number | null;
  branch_ids: string[];
  alternatives?: CustomerRewardAlternative[];
}
export interface CustomerHospitalityEntitlement {
  id: string;
  title: string;
  reward_name: string;
  reward_id?: string;
  branch_id?: string | null;
  expires_at: string;
  available?: boolean;
  stock?: number | null;
  redemption_id?: string | null;
}
export interface CustomerRewardEntitlementsResponse {
  region?: { locale?: string; currency?: string; timezone?: string };
  cycle: CustomerProtectedCycle | null;
  promises: CustomerPromisedReward[];
  hospitality: CustomerHospitalityEntitlement[];
  points: number;
  server_now: string;
}
