/** Browser contracts reviewed against the merchant launch and region services. */
export interface ApiError extends Error { status?: number; code?: string }
export interface MerchantRegion {
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  minorUnits: number;
}
export type RegionDraft = Pick<MerchantRegion, 'country' | 'currency' | 'timezone'>;
export interface RegionUpdate extends RegionDraft { version: string; confirmed_currency?: string }
export interface RegionResponse {
  region: MerchantRegion;
  version: string;
  currency_locked: boolean;
  currency_confirmed: boolean;
  currency_confirmed_at?: string | null;
  countries: Record<string, { name: string; currency: string; timezone: string; locale: string; dialCode: string }>;
  currencies: Record<string, string>;
}
export type ProgramType = 'SPEND' | 'VISIT' | 'ITEM' | 'DISCOUNT' | 'STAMP' | 'CASHBACK' | 'GIFT_CARD';
export type Rounding = 'ceil' | 'round' | 'floor';
export interface ProgramUpdate { program_type: ProgramType; rate?: number; round?: Rounding; percent_off?: number; stamps_required?: number; head_start?: number; reward_label?: string; stamp_unit?: 'visit' | 'item'; cashback_percent?: number; load_bonus_percent?: number; version: string }
// Existing stored configurations can have an unavailable rate (points programs)
// or percent_off (discount programs). The form validates before saving; an empty
// NumberInput also holds a string.
export interface ProgramBasics { program_type: ProgramType; rate: number | null; round: Rounding; percent_off: number | null; stamps_required: number | null; head_start: number | null; reward_label: string | null; stamp_unit: 'visit' | 'item'; cashback_percent: number | null; load_bonus_percent: number | null; version: string }
export interface ProgramForm { program_type: ProgramType; rate: number | string | null; round: Rounding; percent_off: number | string | null; stamps_required: number | string | null; head_start: number | string | null; reward_label: string | null; stamp_unit: 'visit' | 'item'; cashback_percent: number | string | null; load_bonus_percent: number | string | null; version: string }
export interface ProgramResponse { ok: boolean; program: ProgramBasics }
// "Tu progreso" (docs/product/2026-11-23-owner-progress.md, v2). Owner role only, every plan.
// GET answers 404 when owner_progress_mode is off; the UI then renders nothing.
export type OwnerProgressMode = 'off' | 'checklist' | 'full';
export type OwnerProgressVariant = 'treatment' | 'holdout';
export type OwnerLaunchStepKey = 'rules' | 'card' | 'practice' | 'team' | 'live';
export type OwnerMilestoneKey = 'programa_en_marcha' | 'first_customer' | 'ya_estan_volviendo' | 'primera_recompensa' | 'primera_revision' | 'clientes_50' | 'clientes_100' | 'clientes_300' | 'primera_automatizacion' | 'primera_campana_medida' | 'primer_pase_wallet' | 'pos_conectado' | 'momentum_4' | 'pionero';
/** Suggested goals in the doc's priority order; the client offers the alternatives from this same list. */
export type OwnerGoalKey = 'launch' | 'first_customer' | 'redemption_comfort' | 'returning_5' | 'reward_speed_review' | 'monthly_review';
export interface OwnerLaunchStep { key: OwnerLaunchStepKey; label: string; done: boolean; done_at?: string | null; href: string }
export interface OwnerLaunch { steps: OwnerLaunchStep[]; done_count: number; total: number; complete: boolean }
/** Counts the server measured, e.g. 3 of 5 returning customers. Absent for binary goals. */
export interface OwnerGoalProgress { current: number; target: number }
export interface OwnerGoal { key: OwnerGoalKey; label: string; progress?: OwnerGoalProgress | null; href: string }
/** reached_at absent or null = not reached yet; acknowledged_at set once the owner dismissed the notice. */
export interface OwnerMilestone { key: OwnerMilestoneKey; label: string; reached_at?: string | null; acknowledged_at?: string | null }
export interface OwnerMomentum { weeks: number; current_week_active: boolean; freezes_available: number }
export interface OwnerProgressResponse {
  mode: OwnerProgressMode;
  variant: OwnerProgressVariant;
  hidden: boolean;
  launch: OwnerLaunch;
  goal: OwnerGoal | null;
  milestones: OwnerMilestone[];
  momentum: OwnerMomentum;
  new_milestones: OwnerMilestoneKey[];
}
export interface OwnerProgressAcknowledge { keys: OwnerMilestoneKey[] }
/** Either switch to a goal or dismiss one (dismissed goals are not re-suggested for 30 days). */
export type OwnerProgressGoalChange = { key: OwnerGoalKey; dismiss?: never } | { dismiss: OwnerGoalKey; key?: never };
export interface OwnerProgressReview { decision: 'keep' | 'adjust'; note?: string }
export interface OwnerProgressVisibility { hidden: boolean }
/** Mutations answer ok; the UI re-reads GET afterwards, so extra fields are ignored. */
export interface OwnerProgressWriteResponse { ok: boolean }
export interface MerchantReadResponses {
  '/api/admin/region': RegionResponse;
  '/api/admin/launch/program': ProgramResponse;
  '/api/admin/owner-progress': OwnerProgressResponse;
}
export interface MerchantPutPayloads {
  '/api/admin/region': RegionUpdate;
  '/api/admin/launch/program': ProgramUpdate;
}
export interface MerchantPostPayloads {
  '/api/admin/owner-progress/acknowledge': OwnerProgressAcknowledge;
  '/api/admin/owner-progress/goal': OwnerProgressGoalChange;
  '/api/admin/owner-progress/review': OwnerProgressReview;
  '/api/admin/owner-progress/visibility': OwnerProgressVisibility;
}
export interface MerchantPostResponses {
  '/api/admin/owner-progress/acknowledge': OwnerProgressWriteResponse;
  '/api/admin/owner-progress/goal': OwnerProgressWriteResponse;
  '/api/admin/owner-progress/review': OwnerProgressWriteResponse;
  '/api/admin/owner-progress/visibility': OwnerProgressWriteResponse;
}
export interface ResourceState<Data> {
  path: string | null;
  refresh: string | number;
  data: Data | null;
  error: ApiError | null;
  loading: boolean;
}
