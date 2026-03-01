export type MaybePromise<T = void> = T | Promise<T>;

export type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;
export type QueryFn = <T extends Element = HTMLElement>(selector: string) => T | null;
export type ToastFn = (message: string) => void;
export type AlertFn = (message: string, opts?: Record<string, unknown>) => MaybePromise<unknown>;
export type ConfirmFn = (message: string, opts?: Record<string, unknown>) => MaybePromise<boolean>;
export type PromptFn = (message: string, opts?: Record<string, unknown>) => MaybePromise<string | null>;

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
  loadRoiReport(): Promise<void>;
  loadJobsStatus(): Promise<void>;
  loadPaymentPending(): Promise<void>;
  loadAlertsCenter(): Promise<void>;
}

export interface AnalyticsDashboardDeps {
  loadOpsSummary(): Promise<void>;
  loadRoiReport(): Promise<void>;
  loadJobsStatus(): Promise<void>;
  loadPaymentPending(): Promise<void>;
  loadAlertsCenter(): Promise<void>;
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
  lifecycle?: LifecycleConfig;
  tier_policy?: TierPolicyConfig;
}

export interface ProgramResponse {
  program_type?: string;
  program_json?: ProgramConfig;
}

export interface ProgramPayload {
  program_type: string;
  program_json: ProgramConfig;
}

export interface ExternalAwardsConfig {
  enabled?: boolean;
  has_api_key?: boolean;
}
