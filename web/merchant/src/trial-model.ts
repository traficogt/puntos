// Self-serve trial state for the owner app (docs/product/2026-11-25-self-serve-trial.md §4.3,
// §7.3). The server exposes the state at GET /api/admin/trial and, additively, on
// GET /api/admin/plan; both are read through normalizeTrial so either source works. The soft
// lock arrives as 402 { code: "TRIAL_LOCKED" | "TRIAL_EXPIRED", upgrade_url } on mutations.

export type TrialStatus = 'none' | 'active' | 'expired' | 'converted';
export type BillingStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'locked';
export type TrialPhase = 'none' | 'active' | 'ending' | 'locked' | 'paid';

export interface TrialSnapshot {
  status: TrialStatus;
  started_at: string | null;
  ends_at: string | null;
  /** Whole days until ends_at as the server counts them; computed from ends_at when absent. */
  days_left: number | null;
}
export interface BillingSnapshot {
  status: BillingStatus;
  currency: string | null;
  provider: string | null;
  /** Data is kept until this instant after a lock (30 days by default), then purged. */
  purge_after: string | null;
}
export interface TrialState {
  trial: TrialSnapshot;
  billing: BillingSnapshot;
  plan: string | null;
  plan_name: string | null;
  upgrade_url: string | null;
  /** True once the billing adapter offers card checkout (wave 2): "Mejorar plan" opens #plan. */
  upgrade_available: boolean;
}
export interface TrialBannerCopy {
  title: string;
  message: string;
  color: 'blue' | 'yellow';
}
export interface UpgradeRequestInput {
  plan: string;
  phone: string;
  preferredTime?: string;
  note?: string;
  currentPlan?: string | null;
}
export interface UpgradeRequestPayload {
  phone: string;
  business_type: string;
  preferred_time: string;
  note: string;
}

const TRIAL_STATUSES: readonly TrialStatus[] = ['none', 'active', 'expired', 'converted'];
const BILLING_STATUSES: readonly BillingStatus[] = ['none', 'trialing', 'active', 'past_due', 'canceled', 'locked'];
const DAY_MS = 86_400_000;
/** The banner turns yellow from day 11 of 14, i.e. when four days or fewer remain (design §7.3). */
export const ENDING_SOON_DAYS = 4;
export const TRIAL_LOCK_CODES: ReadonlySet<string> = new Set(['TRIAL_LOCKED', 'TRIAL_EXPIRED']);
export const TRIAL_LOCK_MESSAGE = 'Tu prueba terminó. Elige un plan para seguir operando.';
export const PLAN_DISPLAY_NAMES: Readonly<Record<string, string>> = { EMPRENDEDOR: 'Conecta', NEGOCIO: 'Impulsa', EMPRESA: 'Expande' };
/** Published list prices (design §1): per branch, per month, USD. */
export const PLAN_PRICES_USD: Readonly<Record<string, number>> = { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 };
export const PLAN_ORDER: readonly string[] = ['EMPRENDEDOR', 'NEGOCIO', 'EMPRESA'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
function asStatus<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(text) ? (text as T) : null;
}
function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

export function planDisplayName(code: string | null | undefined): string | null {
  const key = String(code ?? '').trim().toUpperCase();
  return key ? (PLAN_DISPLAY_NAMES[key] ?? key) : null;
}

/** Whole days from `now` until `endsAt`, never negative; null when the instant is unreadable. */
export function daysLeft(endsAt: string | null, now: Date = new Date()): number | null {
  if (!endsAt) return null;
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

/**
 * Accepts the nested shape ({ trial: {...}, billing: {...}, plan, plan_name, upgrade_url }), a
 * business-row shape ({ trial_status, trial_ends_at, billing_status, purge_after }) or a flat
 * one ({ status, ends_at, days_left }). Returns null when the payload carries no trial state at
 * all, which is what a 404 (feature not deployed) or a legacy plan response produce.
 */
export function normalizeTrial(payload: unknown, now: Date = new Date()): TrialState | null {
  const root = asRecord(payload);
  if (!root) return null;
  const trialNode = asRecord(root.trial);
  const billingNode = asRecord(root.billing);
  const flatStatus = asString(root.status);
  const trialStatus =
    asStatus(trialNode?.status, TRIAL_STATUSES) ??
    asStatus(root.trial_status, TRIAL_STATUSES) ??
    asStatus(flatStatus, TRIAL_STATUSES);
  const billingStatus =
    asStatus(billingNode?.status, BILLING_STATUSES) ??
    asStatus(root.billing_status, BILLING_STATUSES) ??
    asStatus(flatStatus, BILLING_STATUSES);
  if (trialStatus === null && billingStatus === null) return null;
  const endsAt = asString(trialNode?.ends_at) ?? asString(root.trial_ends_at) ?? asString(root.ends_at);
  const startedAt = asString(trialNode?.started_at) ?? asString(root.trial_started_at) ?? asString(root.started_at);
  const serverDays = asInteger(trialNode?.days_left) ?? asInteger(root.days_left);
  const resolvedBilling: BillingStatus = billingStatus ?? (trialStatus === 'active' ? 'trialing' : trialStatus === 'expired' ? 'locked' : 'none');
  const resolvedTrial: TrialStatus = trialStatus ?? (resolvedBilling === 'trialing' ? 'active' : resolvedBilling === 'locked' ? 'expired' : 'none');
  const plan = asString(root.plan);
  return {
    trial: { status: resolvedTrial, started_at: startedAt, ends_at: endsAt, days_left: serverDays ?? daysLeft(endsAt, now) },
    billing: {
      status: resolvedBilling,
      currency: asString(billingNode?.currency) ?? asString(root.billing_currency),
      provider: asString(billingNode?.provider),
      purge_after: asString(billingNode?.purge_after) ?? asString(root.purge_after),
    },
    plan,
    plan_name: asString(root.plan_name) ?? planDisplayName(plan),
    upgrade_url: asString(root.upgrade_url) ?? asString(trialNode?.upgrade_url),
    upgrade_available: [trialNode?.upgrade_available, billingNode?.upgrade_available, root.upgrade_available].some((flag) => flag === true),
  };
}

export function trialPhase(state: TrialState | null): TrialPhase {
  if (!state) return 'none';
  if (state.billing.status === 'locked') return 'locked';
  if (state.billing.status === 'trialing' || (state.billing.status === 'none' && state.trial.status === 'active')) {
    const left = state.trial.days_left;
    return left !== null && left <= ENDING_SOON_DAYS ? 'ending' : 'active';
  }
  if (state.billing.status === 'active' || state.trial.status === 'converted') return 'paid';
  return 'none';
}

export function trialBannerCopy(state: TrialState | null): TrialBannerCopy | null {
  const phase = trialPhase(state);
  if (!state || (phase !== 'active' && phase !== 'ending')) return null;
  const plan = state.plan_name ?? 'Conecta';
  const left = state.trial.days_left;
  const message =
    left === null
      ? `Tu prueba gratis de ${plan} está activa.`
      : left <= 0
        ? `Tu prueba gratis de ${plan} termina hoy.`
        : left === 1
          ? `Te queda 1 día de prueba gratis con ${plan}.`
          : `Te quedan ${left} días de prueba gratis con ${plan}.`;
  return { title: 'Prueba gratis', message, color: phase === 'ending' ? 'yellow' : 'blue' };
}

export function isTrialLockError(error: unknown): boolean {
  const record = asRecord(error);
  if (!record) return false;
  return record.status === 402 || (typeof record.code === 'string' && TRIAL_LOCK_CODES.has(record.code));
}

export function lockErrorUpgradeUrl(error: unknown): string | null {
  return asString(asRecord(error)?.upgrade_url);
}

export function formatTrialDate(value: string | null | undefined, locale = 'es-GT', timeZone = 'America/Guatemala'): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(date);
}

export function upgradePlanOptions(): Array<{ value: string; label: string }> {
  return PLAN_ORDER.map((code) => ({
    value: code,
    label: `${PLAN_DISPLAY_NAMES[code]} · USD ${PLAN_PRICES_USD[code]} por sucursal al mes`,
  }));
}

/** The next tier up from the current plan; Impulsa when the plan is unknown. */
export function suggestedUpgradePlan(currentPlan: string | null | undefined): string {
  const index = PLAN_ORDER.indexOf(String(currentPlan ?? '').toUpperCase());
  return PLAN_ORDER[Math.min(PLAN_ORDER.length - 1, index < 0 ? 1 : index + 1)];
}

/**
 * Reuses POST /api/admin/concierge-request (owner-authenticated contact mailer; strict schema:
 * phone 7–25, business_type ≤ 60, preferred_time ≤ 120, note ≤ 1000). No payment provider is
 * wired in wave 1, so the upgrade is a request the team answers.
 */
export function upgradeRequestPayload(input: UpgradeRequestInput): UpgradeRequestPayload {
  const code = String(input.plan || '').toUpperCase();
  const name = planDisplayName(code) ?? code;
  const price = PLAN_PRICES_USD[code];
  const current = planDisplayName(input.currentPlan ?? null);
  const lines = [
    `Plan solicitado: ${name} (${code})${price ? ` · USD ${price} por sucursal al mes` : ''}.`,
    current ? `Plan actual: ${current}.` : '',
    String(input.note || '').trim(),
  ].filter(Boolean);
  return {
    phone: String(input.phone || '').trim().slice(0, 25),
    business_type: 'Mejorar plan',
    preferred_time: String(input.preferredTime || '').trim().slice(0, 120),
    note: lines.join('\n').slice(0, 1000),
  };
}
