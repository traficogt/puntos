export interface SuperPlanFeatureMap {
  [key: string]: boolean;
}

export interface SuperPlanLimits {
  branches?: number;
  rewards?: number;
  activeCustomers?: number;
  [key: string]: unknown;
}

export interface SuperPlanPricing {
  monthly?: number;
  yearly?: number;
}

export interface SuperPlanMessaging {
  included_messages?: number;
  overage_per_message_q?: number;
}

export interface SuperPlanDefinition {
  plan: string;
  features?: SuperPlanFeatureMap;
  limits?: SuperPlanLimits;
  pricing_gtq?: SuperPlanPricing;
  messaging_gtq?: SuperPlanMessaging;
}

export interface SuperWalletBroadcast {
  enabled: boolean;
  dailyCap?: number;
  monthlyCap?: number;
  channelPolicy: string;
}

export type SuperTrialStatus = "none" | "active" | "expired" | "converted";
export type SuperBillingStatus = "none" | "trialing" | "active" | "past_due" | "canceled" | "locked";

export interface SuperBusinessRow {
  id: string;
  name: string;
  slug?: string | null;
  email?: string | null;
  plan: string;
  created_at?: string;
  customers?: number;
  staff?: number;
  wallet_broadcast?: SuperWalletBroadcast;
  /** Self-serve trial columns (docs/product/2026-11-25-self-serve-trial.md §3.1); absent on older servers. */
  signup_source?: "internal" | "self_serve" | "super" | "api" | string;
  trial_status?: SuperTrialStatus;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_phone?: string | null;
  billing_status?: SuperBillingStatus;
  locked_at?: string | null;
  purge_after?: string | null;
}

export interface SuperTrialCohort {
  week?: string;
  period_start?: string;
  starts?: number;
  activated?: number;
  converted?: number;
  locked?: number;
  purged?: number;
}

export interface SuperTrialsSummaryResponse {
  ok?: boolean;
  cohorts?: SuperTrialCohort[];
  median_days_to_first_customer?: number | null;
}

export interface SuperStaffRow {
  id: string;
  business_id: string;
  branch_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  active?: boolean;
  can_manage_gift_cards?: boolean;
  created_at?: string;
}

export interface SuperCustomerRow {
  id: string;
  phone?: string | null;
  name?: string | null;
  created_at?: string;
  last_visit_at?: string | null;
  points?: number;
  pending_points?: number;
  lifetime_points?: number;
}

export interface SuperSecurityEvent {
  created_at?: string;
  event_type: string;
  method?: string | null;
  route?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

export interface SuperPlansResponse {
  plans?: SuperPlanDefinition[];
}

export interface SuperOwnerProgressSettings {
  mode: "off" | "checklist" | "full";
  holdout_pct: number;
}

export interface SuperOwnerProgressSettingsResponse {
  ok?: boolean;
  settings?: SuperOwnerProgressSettings;
}

export interface SuperBusinessesResponse {
  businesses?: SuperBusinessRow[];
}

export interface SuperStaffListResponse {
  rows?: SuperStaffRow[];
}

export interface SuperCustomerListResponse {
  rows?: SuperCustomerRow[];
}

export interface SuperMagicLinkResponse {
  ok?: boolean;
  id?: string;
  url?: string;
  expiresAt?: string;
  usageMode?: string;
}

export interface SuperSecurityPostureResponse {
  counts?: Record<string, number>;
  recent?: SuperSecurityEvent[];
}

export interface SuperBusinessCreateResponse {
  business?: {
    name?: string;
  };
}

export interface SuperBusinessUserCreateResponse {
  user?: {
    email?: string;
    name?: string;
    role?: string;
  };
}

export type SuperApiFn = (path: string, opts?: RequestInit) => Promise<any>;
export type SuperQueryFn = (selector: string) => Element | null;
export type SuperToastFn = (message: string) => void;

export interface SuperPageDependencies {
  api: SuperApiFn;
  $: SuperQueryFn;
  toast: SuperToastFn;
}

export interface SuperPageState {
  planList: SuperPlanDefinition[];
  ownerProgressSettings?: SuperOwnerProgressSettings | null;
  businessList: SuperBusinessRow[];
  magicActorRows: SuperStaffRow[] | SuperCustomerRow[];
  /** Bumped on every login, logout or cross-tab session change; stale loads check it. */
  sessionGeneration: number;
  /** A logout was requested but the server has not confirmed the revocation yet. */
  logoutPending: boolean;
  sessionActionInProgress: boolean;
}

export interface SuperPageContext extends SuperPageDependencies {
  state: SuperPageState;
  element(selector: string): HTMLElement;
  input(selector: string): HTMLInputElement;
  select(selector: string): HTMLSelectElement;
  run<T>(
    task: () => Promise<T>,
    onError?: (error: Error & { status?: number; code?: string }) => T | null | Promise<T | null>,
  ): Promise<T | null>;
}

/** Actor rows as the magic-link picker reads them: staff rows carry email and role, customer rows do not. */
export interface SuperMagicActorView {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string;
}
