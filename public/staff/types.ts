export interface StaffProfile {
  id: string;
  business_id: string;
  role: string;
  branch_id?: string | null;
  can_manage_gift_cards?: boolean;
  [key: string]: unknown;
}

export interface StaffMeResponse {
  staff: StaffProfile;
  features?: Record<string, boolean>;
}

export interface StaffPermissionsResponse {
  matrix?: Record<string, string[]>;
}

export interface StaffProgramRule {
  region?: { currency: string; locale: string; timezone: string; minorUnits: number };
  /** SPEND, VISIT, ITEM, DISCOUNT, STAMP, CASHBACK or GIFT_CARD. */
  program_type: string;
  program_json?: Record<string, any>;
}

export interface StaffAwardResponse {
  customerId: string;
  pointsAwarded: number;
  newBalance: number;
  status?: string;
}

export interface StaffSelectedCustomer {
  id: string;
  name?: string | null;
  phone?: string | null;
  points?: number;
  pending_points?: number;
}

export interface StaffLookupCustomerResponse {
  customer: StaffSelectedCustomer;
  wallet?: {
    kind: string;
    balance_q: number;
    percent?: number | null;
    bonus_percent?: number | null;
  } | null;
}

export interface StaffSyncResult {
  ok?: boolean;
  txId?: string;
  error?: string;
}

export interface StaffSyncResponse {
  results: StaffSyncResult[];
}

export interface StaffRewardOption {
  id: string;
  name: string;
  points_cost: number;
}

export interface StaffRewardsResponse {
  rewards: StaffRewardOption[];
}

export interface StaffRedeemResponse {
  redemptionId?: string;
  redemptionCode: string;
  newBalance: number;
}

export interface StaffGiftCard {
  balance_q?: number;
  status?: string;
}

export interface StaffGiftRedeemResponse {
  gift_card: StaffGiftCard;
}

export interface StaffLoginPayload {
  email: string;
  password: string;
}

export interface QueuedStaffAward {
  businessId?: string;
  staffId?: string;
  offlineGrant?: string;
  customerQrToken: string;
  amount_q: number;
  visits: number;
  items: number;
  txId: string;
  meta: {
    ui: string;
  };
  client_ts?: string;
  created_at?: string;
  updated_at?: string;
  status?: "queued" | "syncing" | "failed" | "quarantined";
  retry_count?: number;
  last_error?: string;
}

export type StaffApiFn = (path: string, opts?: RequestInit) => Promise<any>;
export type StaffQueryFn = (selector: string) => Element | null;
export type StaffToastFn = (message: string) => void;
export type StaffActionError = Error & { code?: string; status?: number; recoveryCaseId?: string };

export interface StaffPageDependencies {
  api: StaffApiFn;
  $: StaffQueryFn;
  toast: StaffToastFn;
  uuidv4: () => string;
  addAward?: Function;
  listAwards?: Function;
  deleteAward?: Function;
}

export interface StaffOfflineGrant {
  grant: string;
  expiresAt: string;
}

/** A reward cycle whose earning terms are protected for the selected customer. */
export interface StaffProtectedCycle {
  program_type: string;
  earning_terms?: Record<string, any> | null;
  [key: string]: unknown;
}

/** Cached identity that lets the scanner keep working offline for 24 h. */
export interface StaffOfflineSnapshot {
  staff: StaffProfile;
  permissions?: string[];
  planFeatures?: Record<string, boolean>;
  programRule?: StaffProgramRule | null;
  offlineGrant?: StaffOfflineGrant | null;
  updatedAt: string;
}

/** Secondary panels mounted once the session is valid. */
export interface StaffServiceMounts {
  serviceCases: any;
  rewardEntitlements: any;
  posRecording: any;
  serviceBriefing: any;
  demandNotebook: any;
}

export interface StaffPageState {
  staff: StaffProfile | null;
  protectedCycle: StaffProtectedCycle | null;
  scanning: boolean;
  lastCustomerId: string | null;
  lastCustomerToken: string;
  lastCashbackBalance: number;
  lastCustomerPoints: number;
  customerSelectionRevision: number;
  awardInFlight: boolean;
  unverifiedSelection: boolean;
  storageFailed: boolean;
  sessionEnded: boolean;
  sessionOnline: boolean;
  offlineGrant: StaffOfflineGrant | null;
  programRule: StaffProgramRule | null;
  rewardOptions: StaffRewardOption[];
  permissionSet: Set<string> | null;
  planFeatures: Record<string, boolean>;
  lastCustomerMovement: string;
  mounts: StaffServiceMounts;
}

export interface StaffPageContext extends StaffPageDependencies {
  state: StaffPageState;
  element(selector: string): HTMLElement;
  input(selector: string): HTMLInputElement;
  select(selector: string): HTMLSelectElement;
  run<T>(
    task: () => Promise<T>,
    onError?: (error: StaffActionError) => T | null | Promise<T | null>,
  ): Promise<T | null>;
}

/** UI reactions the session module triggers but other modules own. */
export interface StaffSessionHooks {
  renderProgramInfo(): void;
  updateInputsForRule(): void;
  applyUiPermissions(): void;
  clearSelectedCustomer(): void;
  stopCamera(): void;
  destroyMounts(): void;
}

/** Business and staff ids an offline award is stored and synchronised under. */
export interface StaffAwardScope {
  businessId: string;
  staffId: string;
}

/** Selected-customer facts the secondary panels read through `getContext()`. */
export interface StaffPanelContext {
  customerId: string | null;
  online: boolean;
  rewardId?: string | null;
  staffId?: string;
  businessId?: string;
  branchId?: string | null;
}

/** Protected promise row from `/api/staff/reward-entitlements` (fields the panel reads). */
export interface StaffPromisedReward {
  id: string;
  reward_id: string;
  reward_name: string;
  points_cost: number;
  valid_until?: string | null;
  effective_valid_until?: string | null;
  available?: boolean;
  stock?: number | null;
  alternatives?: { id: string; name: string; stock?: number | null }[];
}
export interface StaffHospitalityEntitlement {
  id: string;
  title: string;
  reward_name: string;
  expires_at: string;
  available?: boolean;
  stock?: number | null;
  redemption_id?: string | null;
}
export interface StaffRewardEntitlementsResponse {
  region?: { locale?: string; timezone?: string };
  cycle: StaffProtectedCycle | null;
  promises: StaffPromisedReward[];
  hospitality: StaffHospitalityEntitlement[];
  points: number;
  server_now: string;
}
/** `/api/staff/hospitality`: courtesy grants the signed-in staff member may issue. */
export interface StaffHospitalityGrant {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  revoked_at?: string | null;
  remaining_units: number;
  remaining_cost: number | string;
  unit_cost_limit: number | string;
}
export interface StaffHospitalityAuthorityResponse {
  grants: StaffHospitalityGrant[];
  server_now: string;
}

/** Service-recovery case as `/api/staff/service-cases` lists it (fields the panel reads). */
export interface StaffServiceCase {
  id: string;
  version: number;
  status: string;
  kind?: string;
  reason: string;
  reward_id?: string | null;
  redemption_id?: string | null;
  branch_id?: string | null;
  evidence?: {
    reward_name_at_report?: string | null;
    promise_terms?: { reward_name: string; points_cost: number } | null;
  } | null;
}
export interface StaffServiceCaseEvent {
  event_type: string;
  details: { reason?: string | null; evidence_level?: string | null };
}
export interface StaffServiceCasePromise {
  id: string;
  reward_id: string;
  reward_name: string;
  points_cost: number;
  valid_until?: string | null;
  alternatives?: { id: string; name: string }[];
}
/** `/api/staff/service-cases/:id`: the case with its history, options and the team that can own it. */
export interface StaffServiceCaseDetail {
  case: StaffServiceCase;
  restoration: { id: string; points_restored: number; created_at: string } | null;
  events?: StaffServiceCaseEvent[];
  promises?: StaffServiceCasePromise[];
  customer_active?: boolean;
  team?: { id: string; name: string; role: string; branch_id?: string | null }[];
  capabilities?: { can_assign?: boolean };
}
/** Completed redemption a service case can reference (`/api/staff/service-redemptions`). */
export interface StaffServiceRedemption {
  id: string;
  reward_id: string;
  reward_name: string;
  code?: string | null;
  points_cost: number;
  points_restored?: boolean;
}

/** `/api/staff/decisions`: owner decisions delegated to this staff member. */
export interface StaffDecisionInboxResponse {
  decisions: {
    key: string;
    title: string;
    explanation: string;
    fingerprint: string;
    review_version: number;
  }[];
}
export interface StaffOfferTemplate {
  id: string;
  name: string;
  version: number;
  revoked_at?: string | null;
  remaining_runs: number;
  expires_at: string;
  audience_count: number;
  terms: { points_budget: number };
}
/** `/api/staff/operating-mode`: pace controls, present only while the owner's authorization is live. */
export type StaffOperatingControlsResponse =
  | {
      authorized: false;
      operating_mode: null;
      permissions: { operating_mode?: boolean };
      templates: StaffOfferTemplate[];
    }
  | {
      authorized: true;
      operating_mode: { mode: string; version: number };
      permissions: { operating_mode?: boolean };
      templates: StaffOfferTemplate[];
    };
