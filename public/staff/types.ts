export interface StaffProfile {
  id: string;
  business_id: string;
  role: string;
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
  wallet?: { kind: string; balance_q: number; percent?: number | null; bonus_percent?: number | null } | null;
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
