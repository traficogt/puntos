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
export type ProgramType = 'SPEND' | 'VISIT' | 'ITEM' | 'DISCOUNT' | 'STAMP' | 'CASHBACK';
export type Rounding = 'ceil' | 'round' | 'floor';
export interface ProgramUpdate { program_type: ProgramType; rate?: number; round?: Rounding; percent_off?: number; stamps_required?: number; head_start?: number; reward_label?: string; stamp_unit?: 'visit' | 'item'; cashback_percent?: number; version: string }
// Existing stored configurations can have an unavailable rate (points programs)
// or percent_off (discount programs). The form validates before saving; an empty
// NumberInput also holds a string.
export interface ProgramBasics { program_type: ProgramType; rate: number | null; round: Rounding; percent_off: number | null; stamps_required: number | null; head_start: number | null; reward_label: string | null; stamp_unit: 'visit' | 'item'; cashback_percent: number | null; version: string }
export interface ProgramForm { program_type: ProgramType; rate: number | string | null; round: Rounding; percent_off: number | string | null; stamps_required: number | string | null; head_start: number | string | null; reward_label: string | null; stamp_unit: 'visit' | 'item'; cashback_percent: number | string | null; version: string }
export interface ProgramResponse { ok: boolean; program: ProgramBasics }
export interface MerchantReadResponses {
  '/api/admin/region': RegionResponse;
  '/api/admin/launch/program': ProgramResponse;
}
export interface MerchantPutPayloads {
  '/api/admin/region': RegionUpdate;
  '/api/admin/launch/program': ProgramUpdate;
}
export interface ResourceState<Data> {
  path: string | null;
  refresh: string | number;
  data: Data | null;
  error: ApiError | null;
  loading: boolean;
}
