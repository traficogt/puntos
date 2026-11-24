export type MaybePromise<T = void> = T | Promise<T>;

export type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;
export type QueryFn = <T extends Element = HTMLElement>(selector: string) => T | null;
export type ToastFn = (message: string) => void;
export type AlertFn = (message: string, opts?: Record<string, unknown>) => MaybePromise<unknown>;
export type ConfirmFn = (message: string, opts?: Record<string, unknown>) => MaybePromise<boolean>;
export type PromptFn = (
  message: string,
  opts?: Record<string, unknown>,
) => MaybePromise<string | null>;

export interface DashboardStaff {
  role: string;
  [key: string]: unknown;
}

export interface DashboardBranch {
  id: string;
  name: string;
  code?: string | null;
  [key: string]: unknown;
}

export interface DashboardPlanInfo {
  plan: string;
  limits: Record<string, unknown>;
  features: Record<string, boolean>;
  /** Soft-cap usage from /api/admin/plan; active_customers is null when unavailable. */
  usage?: { active_customers?: number | null };
}

export interface DashboardState {
  currentStaff: DashboardStaff | null;
  managerMode: boolean;
  planInfo: DashboardPlanInfo;
  branchCache: DashboardBranch[];
  initialProgramLoad: Promise<unknown>;
  persistedBranchId: string;
  persistedActiveTab: string;
}

export interface TabDefinition {
  feature?: string | null;
  allowManager?: boolean;
  load: () => Promise<void>;
}

export type DashboardHook = () => MaybePromise<void>;
export type BranchChangedHook = (branchId: string) => MaybePromise<void>;
export type BranchesUpdatedHook = (branches: DashboardBranch[]) => MaybePromise<void>;

export interface SyncViewArgs {
  activeTab?: string;
  branchId?: string;
}

export interface RestoredDashboardView {
  branchId: string;
  activeTab: string;
  fallbackBranchId?: string;
}

export type ActivateTab = (tabName: string, options?: { syncUrl?: boolean }) => void;

export interface AdminDashboardDependencies {
  api: ApiFn;
  $: QueryFn;
  toast: ToastFn;
  alert: AlertFn;
  confirm: ConfirmFn;
  prompt: PromptFn;
}

export interface AdminDashboardApp extends AdminDashboardDependencies {
  state: DashboardState;
  registerTab(tabName: string, definition: TabDefinition): void;
  onAfterPlanReady(fn: DashboardHook): void;
  onBranchFilterChanged(fn: BranchChangedHook): void;
  onBranchesUpdated(fn: BranchesUpdatedHook): void;
  hasFeature(feature: string): boolean;
  requiredPlanLabel(feature: string): string;
  selectedBranchId(): string;
  branchQueryString(): string;
  selectedBranchLabel(): string;
  applyBranchDrilldown(branchId: string): Promise<void>;
  safeColor(value: unknown, fallback?: string): string;
  setSmallMessage(container: Element, message: string): void;
  activateTab(tabName: string, options?: { syncUrl?: boolean }): void;
  loadTabData(tabName: string): Promise<void>;
  applyFeatureGates(): void;
  setBranches(next: DashboardBranch[]): void;
  updateDashboardChrome(tabName?: string): void;
  start(): Promise<void>;
}

export interface AnalyticsController {
  init(): void;
}

export interface AnalyticsLoadController extends AnalyticsController {
  loadAnalytics(): Promise<void>;
}

export interface AnalyticsAuditController extends AnalyticsController {
  loadAuditTimeline(): Promise<void>;
}

export interface AnalyticsOperationsController extends AnalyticsController {
  loadOpsSummary(): Promise<void>;
  loadRoiReport(
    prefetched?: { roi?: Record<string, unknown> } | null,
  ): Promise<{ roi?: Record<string, unknown> } | null>;
  loadJobsStatus(): Promise<void>;
  loadPaymentPending(): Promise<void>;
  loadAlertsCenter(
    prefetched?: { alerts?: Array<Record<string, unknown>> } | null,
  ): Promise<{ alerts?: Array<Record<string, unknown>> } | null>;
}

export interface AnalyticsDashboardDeps {
  loadOpsSummary(): Promise<void>;
  loadRoiReport(
    prefetched?: { roi?: Record<string, unknown> } | null,
  ): Promise<{ roi?: Record<string, unknown> } | null>;
  loadJobsStatus(): Promise<void>;
  loadPaymentPending(): Promise<void>;
  loadAlertsCenter(
    prefetched?: { alerts?: Array<Record<string, unknown>> } | null,
  ): Promise<{ alerts?: Array<Record<string, unknown>> } | null>;
  loadAuditTimeline(): Promise<void>;
}

export interface AnalyticsModuleControllers {
  audit: AnalyticsAuditController;
  operations: AnalyticsOperationsController;
  dashboard: AnalyticsLoadController;
}

export interface AnalyticsSummary {
  total_customers?: number;
  new_customers_30d?: number;
  high_churn_risk_count?: number;
  avg_customer_spend?: number | string;
}

export interface AnalyticsRfmSegment {
  segment: string;
  count?: number;
}

export interface AnalyticsActivityRow {
  date: string;
  revenue?: number;
}

export interface AnalyticsChurnCustomer {
  name?: string;
  phone?: string;
  days_since_last_purchase?: number;
  churn_risk_score?: number;
  total_spend?: number | string;
}

export interface AnalyticsBranchPerformanceRow {
  branch_id: string;
  branch_name: string;
  branch_code?: string | null;
  revenue_30d?: number | string;
  active_customers_30d?: number;
  tx_30d?: number;
  redemptions_30d?: number;
}

export interface AnalyticsCohortRow {
  cohort_month?: string;
  m1?: number;
  m2?: number;
  m3?: number;
}

export interface AnalyticsDashboardResponse {
  summary?: AnalyticsSummary;
  rfm_distribution?: AnalyticsRfmSegment[];
  recent_activity?: AnalyticsActivityRow[];
  branch_performance?: AnalyticsBranchPerformanceRow[];
}

export interface LifecycleConfig {
  birthday_enabled?: boolean;
  birthday_points?: number;
  winback_enabled?: boolean;
  winback_days?: number;
  winback_points?: number;
  scheduler_hour_local?: number;
  scheduler_tz?: string;
}

export interface TierPolicyConfig {
  mode?: string;
  rolling_days?: number;
  grace_days?: number;
}

export interface AwardGuardConfig {
  max_amount_q?: number;
  max_points_per_tx?: number;
  max_visits?: number;
  max_items?: number;
  suspicious_points_threshold?: number;
  suspicious_amount_q_threshold?: number;
}

export interface RedemptionGuardConfig {
  max_redemptions_per_day?: number;
  max_reward_redemptions_per_day?: number;
  reward_cooldown_hours?: number;
}

export interface ProgramConfig {
  points_per_q?: number;
  round?: string;
  points_per_visit?: number;
  points_per_item?: number;
  pending_points_hold_days?: number;
  points_expiration_days?: number;
  award_guard?: AwardGuardConfig;
  redemption_guard?: RedemptionGuardConfig;
  balance_policy?: {
    allow_negative_balance_on_refund?: boolean;
  };
  lifecycle?: LifecycleConfig;
  tier_policy?: TierPolicyConfig;
}

export interface ProgramResponse {
  program_type?: string;
  program_json?: ProgramConfig;
}

export interface CustomerBrandingConfig {
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
}

export interface BrandingResponse {
  customer_branding?: CustomerBrandingConfig;
}

export interface ProgramPayload {
  program_type: string;
  program_json: ProgramConfig;
}

export interface ExternalAwardsConfig {
  enabled?: boolean;
  has_api_key?: boolean;
}

/** Row of `/api/admin/awards/suspicious` (fields the operations panel prints). */
export interface SuspiciousAwardRow {
  created_at: string;
  staff_name?: string | null;
  staff_email?: string | null;
  staff_user_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_id: string;
  guard?: { reasons?: string[] } | null;
  branch_name?: string | null;
  branch_id?: string | null;
  points: number;
  amount_q?: number | null;
}

/** Audit event as `/api/admin/audit` lists it (fields the timeline reads). */
export interface AuditEvent {
  id: string;
  action: string;
  created_at?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  actor_type?: string | null;
  meta?: Record<string, unknown> | null;
}
/** `/api/admin/audit/:id`: the event with the records it touched. */
export interface AuditEventDetail {
  event: AuditEvent;
  linked?: {
    transaction?: {
      id: string;
      customer_name?: string | null;
      customer_phone?: string | null;
      source?: string;
      status?: string;
      points?: number | null;
    } | null;
    reversal_transaction?: {
      id: string;
      status?: string;
      points?: number | null;
      reversal_reason?: string | null;
    } | null;
    redemption?: {
      code?: string;
      reward_name?: string;
      customer_name?: string | null;
      customer_phone?: string | null;
      points_cost?: number | null;
    } | null;
    gift_card?: { code?: string; balance_q?: number | null; status?: string } | null;
    gift_card_transaction?: {
      tx_type?: string;
      amount_q?: number | null;
      balance_after_q?: number | null;
    } | null;
  } | null;
}

/** Background job row from `/api/admin/jobs`. */
export interface AdminJobRow {
  job_type: string;
  status?: string;
  created_at?: string | null;
  attempts?: number;
  error?: string | null;
}
/** Payment webhook awaiting a customer mapping (`/api/admin/payment-webhooks`). */
export interface AdminPaymentEvent {
  id: string;
  provider?: string | null;
  provider_event_id?: string | null;
  created_at?: string | null;
  amount_q?: number | string | null;
  customer_phone?: string | null;
}

/** POS sales review (`/api/admin/pos/csv/preview`, `/api/admin/pos/loyverse/preview`). */
export interface PosSalesPreview {
  headers?: string[];
  summary?: {
    total?: number;
    ready?: number;
    duplicates?: number;
    ignored?: number;
    errors?: number;
  };
  rows?: Array<{
    row?: number | null;
    saleId?: string | null;
    customerPhone?: string | null;
    amountQ?: number | string | null;
    points?: number | null;
    status: string;
    message?: string | null;
  }>;
  has_more?: boolean;
}
/** Outcome of a POS import or sync. */
export interface PosImportResult {
  awarded?: number;
  duplicates?: number;
  ignored?: number;
  errors?: number;
  has_more?: boolean;
  issues?: Array<{
    saleId?: string | null;
    row?: number | null;
    message?: string | null;
    code?: string | null;
  }>;
}
