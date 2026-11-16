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
export type ProgramType = 'SPEND' | 'VISIT' | 'ITEM';
export type Rounding = 'ceil' | 'round' | 'floor';
export interface ProgramUpdate { program_type: ProgramType; rate: number; round: Rounding; version: string }
// Existing stored configurations can have an unavailable rate. The form must
// validate it before saving; an empty NumberInput also holds a string.
export interface ProgramBasics extends Omit<ProgramUpdate, 'rate'> { rate: number | null }
export interface ProgramForm extends Omit<ProgramUpdate, 'rate'> { rate: number | string | null }
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
