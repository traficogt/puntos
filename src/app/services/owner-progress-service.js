// Owner progress ("Tu progreso"): a private, business-level progress layer for owners.
// Design of record: docs/product/2026-11-23-owner-progress.md (v2).
//
// Everything is derived from existing records; nothing asks the owner to self-report.
// The pure model (buildOwnerProgress) works on a facts object so it is testable without
// a database; the loader gathers those facts with parameterized queries that run under
// the caller's tenant context (RLS), exactly like the other owner reports.
import { createHash, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { dbQuery } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { PlatformSettingsRepo } from "../repositories/platform-settings-repository.js";
import { badRequest, notFound } from "../../utils/http-error.js";
import { businessRegion } from "./regional-settings.js";
import { reportingPurchase } from "./reporting-purchase.js";
import { programRuleConfigured } from "./transaction-rule-evidence.js";

/**
 * Facts gathered by loadOwnerProgressFacts; the pure model reads nothing else.
 * @typedef {Awaited<ReturnType<typeof loadOwnerProgressFacts>>} OwnerProgressFacts
 *
 * Platform setting as resolved by resolveOwnerProgressSettings.
 * @typedef {{ mode: string, holdout_pct: number }} OwnerProgressSettings
 *
 * owner_progress_state row (one per business; every column may still be null).
 * @typedef {{
 *   hidden?: boolean | null,
 *   current_goal?: string | null,
 *   dismissed_goals?: Record<string, string> | null,
 *   last_review_at?: Date | string | null,
 *   last_review_decision?: string | null,
 *   freezes_used?: number | string | null
 * }} OwnerProgressStateRow
 *
 * The normalized state the model works with.
 * @typedef {{
 *   hidden: boolean,
 *   current_goal: string | null,
 *   dismissed_goals: Record<string, string>,
 *   last_review_at: string | null,
 *   last_review_decision: string | null,
 *   freezes_used: number
 * }} OwnerProgressState
 *
 * owner_progress_milestones row.
 * @typedef {{ key: string, reached_at: Date | string | null, acknowledged_at: Date | string | null }} OwnerProgressMilestoneRow
 *
 * The businesses columns this service reads (repositories owner's table).
 * @typedef {{ id: string, name: string, program_json: Record<string, any> | null, owner_progress_variant: string | null }} OwnerProgressBusinessRow
 *
 * Parameterized query bound to the caller's database context (dbQuery or a client).
 * @typedef {(sql: string, params?: any[]) => Promise<{ rows: any[] }>} OwnerProgressQuery
 *
 * Evaluated launch path, momentum and state handed to milestone and goal predicates.
 * @typedef {{
 *   launch: ReturnType<typeof evaluateLaunch>,
 *   momentum: ReturnType<typeof computeMomentum>,
 *   state: OwnerProgressState,
 *   now: Date
 * }} OwnerProgressContext
 *
 * @typedef {{
 *   key: string,
 *   label: string,
 *   href: string,
 *   done: (facts: OwnerProgressFacts) => boolean,
 *   doneAt: (facts: OwnerProgressFacts) => string | null | undefined
 * }} OwnerProgressLaunchStep
 * @typedef {{
 *   key: string,
 *   label: string,
 *   done: (facts: OwnerProgressFacts, context: OwnerProgressContext) => boolean
 * }} OwnerProgressMilestone
 * @typedef {{
 *   key: string,
 *   label: string,
 *   href: string,
 *   open: (facts: OwnerProgressFacts, context: OwnerProgressContext) => boolean,
 *   progress: (facts: OwnerProgressFacts, context: OwnerProgressContext) => { current: number, target: number } | null
 * }} OwnerProgressGoal
 *
 * Injectable collaborators; unit tests supply fakes. `audit` is AuditRepo.log
 * (repositories owner), `getSettings` reads the platform setting.
 * @typedef {{
 *   query?: OwnerProgressQuery,
 *   getSettings?: () => Promise<Record<string, any> | null | undefined>,
 *   audit?: typeof AuditRepo.log
 * }} OwnerProgressInjected
 *
 * Identity and context the owner routes pass to every action.
 * @typedef {{
 *   businessId: string,
 *   staffId?: string | null,
 *   ip?: string | null,
 *   ua?: string | null,
 *   settings?: OwnerProgressSettings,
 *   now?: Date
 * }} OwnerProgressActionOptions
 */

export const OWNER_PROGRESS_MODES = ["off", "checklist", "full"];
export const OWNER_PROGRESS_DEFAULTS = { mode: "full", holdout_pct: 0 };
const GOAL_DISMISSAL_DAYS = 30;
const REVIEW_AFTER_DAYS = 30;
const FREEZE_EVERY_WEEKS = 8;

/** Platform setting validation (super API) and normalization of stored JSON. */
export const OwnerProgressSettingsSchema = z
  .object({
    mode: z.enum(["off", "checklist", "full"]),
    holdout_pct: z.number().int().min(0).max(100),
  })
  .strict();
/**
 * @param {Record<string, any> | null | undefined} raw stored platform-setting JSON
 * @returns {OwnerProgressSettings}
 */
export function resolveOwnerProgressSettings(raw) {
  // A mode found in the catalog implies a non-null setting object.
  const mode = OWNER_PROGRESS_MODES.includes(raw?.mode)
    ? /** @type {Record<string, any>} */ (raw).mode
    : OWNER_PROGRESS_DEFAULTS.mode;
  const pct = Number(raw?.holdout_pct);
  return {
    mode,
    holdout_pct:
      Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : OWNER_PROGRESS_DEFAULTS.holdout_pct,
  };
}

/**
 * Deterministic variant: sha256(business_id) mod 100 < holdout_pct → holdout.
 * @param {string} businessId
 * @param {number | string | null | undefined} holdoutPct
 */
export function assignOwnerProgressVariant(businessId, holdoutPct) {
  const digest = createHash("sha256").update(String(businessId)).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < Number(holdoutPct || 0) ? "holdout" : "treatment";
}

/** @param {string} fragment */
const href = (fragment) => `/negocio/#${fragment}`;
/**
 * The launch path ("Programa en marcha"), in order. Each `done` reads only facts.
 * @type {OwnerProgressLaunchStep[]}
 */
export const LAUNCH_STEPS = [
  {
    key: "rules",
    label: "Reglas y recompensa listas",
    href: href("preparar"),
    done: (f) => f.program_configured === true && f.active_rewards >= 1,
    doneAt: () => null,
  },
  {
    key: "card",
    label: "Tarjeta e inscripción listas",
    href: href("marca"),
    done: (f) => f.enrollment_sources >= 1 || f.branded_qr_enabled === true,
    doneAt: (f) => f.first_source_at ?? null,
  },
  {
    key: "practice",
    label: "Práctica de acumular y canjear",
    href: "/equipo/escaner/",
    done: (f) => f.practice_completed >= 1,
    doneAt: (f) => f.first_practice_at ?? null,
  },
  {
    key: "team",
    label: "Equipo preparado",
    href: href("personal"),
    done: (f) => f.team_ready >= 1,
    doneAt: () => null,
  },
  {
    key: "live",
    label: "Participación real iniciada",
    href: href("movimientos"),
    done: (f) => f.genuine_awards >= 1,
    doneAt: (f) => f.first_award_at ?? null,
  },
];

/**
 * Milestones (v1 set). `done` receives facts plus the evaluated launch and momentum.
 * @type {OwnerProgressMilestone[]}
 */
export const MILESTONES = [
  { key: "programa_en_marcha", label: "Programa en marcha", done: (f, c) => c.launch.complete },
  {
    key: "primer_cliente",
    label: "Primer cliente participando",
    done: (f) => f.genuine_awards >= 1,
  },
  {
    key: "ya_estan_volviendo",
    label: "Ya están volviendo",
    done: (f) => f.returning_customers >= 5,
  },
  {
    key: "primera_recompensa",
    label: "Primera recompensa entregada",
    done: (f) => f.genuine_redemptions >= 1,
  },
  {
    key: "primera_revision",
    label: "Primera revisión del programa",
    done: (f, c) => Boolean(c.state.last_review_at),
  },
  { key: "clientes_50", label: "50 clientes", done: (f) => f.active_customers >= 50 },
  { key: "clientes_100", label: "100 clientes", done: (f) => f.active_customers >= 100 },
  { key: "clientes_300", label: "300 clientes", done: (f) => f.active_customers >= 300 },
  {
    key: "primera_automatizacion",
    label: "Primera automatización activa",
    done: (f) => f.automation_live === true,
  },
  {
    key: "primera_campana_medida",
    label: "Primera campaña medida",
    done: (f) => f.campaigns_measured >= 1,
  },
  { key: "primer_pase_wallet", label: "Primer pase en Wallet", done: (f) => f.wallet_passes >= 1 },
  {
    key: "pos_conectado",
    label: "Punto de venta conectado",
    done: (f) => f.pos_connected === true,
  },
  { key: "momentum_4", label: "Cuatro semanas de impulso", done: (f, c) => c.momentum.weeks >= 4 },
  { key: "pionero", label: "Comercio pionero", done: (f) => f.pilot === true },
];
export const MILESTONE_KEYS = MILESTONES.map((m) => m.key);

/**
 * Suggested goals in priority order. `open` is true while the goal still applies.
 * The owner may pick any open goal or dismiss one (not re-suggested for 30 days).
 * @type {OwnerProgressGoal[]}
 */
export const GOALS = [
  {
    key: "launch",
    label: "Terminar la puesta en marcha",
    href: href("preparar"),
    open: (f, c) => !c.launch.complete,
    progress: (f, c) => ({ current: c.launch.done_count, target: c.launch.total }),
  },
  {
    key: "first_customer",
    label: "Primer cliente participando",
    href: href("marca"),
    open: (f) => f.genuine_awards === 0,
    progress: () => null,
  },
  {
    key: "redemption_comfort",
    label: "Equipo cómodo con el canje",
    href: href("canjes"),
    open: (f) => f.genuine_awards >= 1 && f.genuine_redemptions === 0,
    progress: () => null,
  },
  {
    key: "returning_5",
    label: "Primeros cinco clientes que vuelven",
    href: href("automatizaciones"),
    open: (f) => f.returning_customers < 5,
    progress: (f) => ({ current: Math.min(5, f.returning_customers), target: 5 }),
  },
  {
    key: "reward_speed_review",
    label: "Revisar si la primera recompensa tarda demasiado",
    href: href("recompensas"),
    open: (f, c) =>
      f.genuine_redemptions === 0 &&
      daysSince(f.first_award_at, c.now) >= REVIEW_AFTER_DAYS &&
      !reviewedAfter(c.state.last_review_at, f.first_award_at),
    progress: () => null,
  },
  {
    key: "monthly_review",
    label: "Revisar un mes de resultados",
    href: href("resumen"),
    open: (f, c) =>
      daysSince(f.first_award_at, c.now) >= REVIEW_AFTER_DAYS &&
      daysSince(c.state.last_review_at, c.now) >= REVIEW_AFTER_DAYS,
    progress: () => null,
  },
];
export const GOAL_KEYS = GOALS.map((g) => g.key);

/**
 * @param {Date | string | null | undefined} value
 * @param {Date} now
 */
function daysSince(value, now) {
  if (!value) return Number.POSITIVE_INFINITY;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? (now.getTime() - at) / 86400000 : Number.POSITIVE_INFINITY;
}
/**
 * @param {Date | string | null | undefined} reviewAt
 * @param {Date | string | null | undefined} sinceAt
 */
function reviewedAfter(reviewAt, sinceAt) {
  return Boolean(reviewAt && sinceAt && new Date(reviewAt) >= new Date(sinceAt));
}

/**
 * Monday-start calendar week (ISO date) that contains `date` in the business timezone.
 * @param {Date | string | number} date
 * @param {string} timezone
 */
export function weekStartOf(date, timezone) {
  return DateTime.fromJSDate(new Date(date), { zone: timezone }).startOf("week").toISODate();
}

/**
 * Weekly "momentum": consecutive calendar weeks (business timezone, Monday start) in
 * which the business either recorded genuine activity or had nothing for the owner to
 * act on. Counting starts at the first week with a genuine award; the current week is
 * "in progress" and never breaks the run. An inactive week with pending owner work can
 * be covered by a freeze: one at the start of a run and one more after every 8 weeks of
 * it. Frozen weeks keep the run but do not add to it; a gap without a freeze resets it.
 * @param {{award_weeks?: string[], todo_weeks?: string[]}} facts
 * @param {{now: Date, timezone: string}} options
 */
export function computeMomentum(facts, { now, timezone }) {
  const awards = new Set(facts.award_weeks ?? []),
    todo = new Set(facts.todo_weeks ?? []);
  const empty = { weeks: 0, current_week_active: false, freezes_available: 1, frozen_weeks: 0 };
  if (!awards.size) return empty;
  const current = weekStartOf(now, timezone);
  if (!current) return empty;
  const first = [...awards].sort()[0];
  const currentActive = awards.has(current);
  // The current week is in progress: it counts when active and is skipped otherwise.
  const end = currentActive
    ? current
    : DateTime.fromISO(current, { zone: timezone }).minus({ weeks: 1 }).toISODate();
  if (!end) return empty;
  let weeks = 0,
    span = 0,
    frozen = 0;
  for (
    let cursor = DateTime.fromISO(first, { zone: timezone });
    ;
    cursor = cursor.plus({ weeks: 1 })
  ) {
    const key = cursor.toISODate();
    // An invalid cursor never reaches a real date; stop instead of looping forever.
    if (!key || key > end) break;
    if (awards.has(key) || !todo.has(key)) {
      weeks++;
      span++;
    } else if (frozen < 1 + Math.floor(span / FREEZE_EVERY_WEEKS)) {
      frozen++;
      span++;
    } else {
      weeks = 0;
      span = 0;
      frozen = 0;
    }
  }
  return {
    weeks,
    current_week_active: currentActive,
    freezes_available: Math.max(0, 1 + Math.floor(span / FREEZE_EVERY_WEEKS) - frozen),
    frozen_weeks: frozen,
  };
}

/** @returns {OwnerProgressState} */
const defaultState = () => ({
  hidden: false,
  current_goal: null,
  dismissed_goals: {},
  last_review_at: null,
  last_review_decision: null,
  freezes_used: 0,
});
/**
 * @param {OwnerProgressStateRow | null | undefined} row
 * @returns {OwnerProgressState}
 */
function normalizeState(row) {
  const base = defaultState();
  if (!row) return base;
  return {
    hidden: row.hidden === true,
    current_goal: row.current_goal ?? null,
    dismissed_goals:
      row.dismissed_goals && typeof row.dismissed_goals === "object" ? row.dismissed_goals : {},
    last_review_at: row.last_review_at ? new Date(row.last_review_at).toISOString() : null,
    last_review_decision: row.last_review_decision ?? null,
    freezes_used: Number(row.freezes_used) || 0,
  };
}

/** @param {OwnerProgressFacts} facts */
function evaluateLaunch(facts) {
  const steps = LAUNCH_STEPS.map((step) => {
    const done = step.done(facts) === true;
    const at = done ? step.doneAt(facts) : null;
    return {
      key: step.key,
      label: step.label,
      done,
      done_at: at ? new Date(at).toISOString() : null,
      href: step.href,
    };
  });
  const done_count = steps.filter((s) => s.done).length;
  return { steps, done_count, total: steps.length, complete: done_count === steps.length };
}

/**
 * @param {OwnerProgressFacts} facts
 * @param {OwnerProgressContext} context
 */
function selectGoal(facts, context) {
  const dismissed = context.state.dismissed_goals ?? {};
  /** @param {string} key */
  const isDismissed = (key) => daysSince(dismissed[key], context.now) < GOAL_DISMISSAL_DAYS;
  const open = GOALS.filter((goal) => goal.open(facts, context));
  const chosen = open.find((goal) => goal.key === context.state.current_goal);
  const goal = chosen ?? open.find((goal) => !isDismissed(goal.key)) ?? null;
  if (!goal) return null;
  const progress = goal.progress(facts, context);
  return { key: goal.key, label: goal.label, href: goal.href, ...(progress ? { progress } : {}) };
}

/**
 * Pure model. Returns the API payload plus `satisfied`, the milestone keys the facts
 * currently satisfy (the caller persists first-reached times).
 * @param {OwnerProgressFacts} facts counts and booleans from loadOwnerProgressFacts
 * @param {{mode: string, variant: string, now?: Date, timezone?: string, state?: OwnerProgressStateRow | null, stored?: Array<{key:string,reached_at:any,acknowledged_at:any}>}} options
 */
export function buildOwnerProgress(facts, options) {
  const now = options.now ?? new Date(),
    timezone = options.timezone ?? "America/Guatemala",
    state = normalizeState(options.state),
    stored = new Map((options.stored ?? []).map((row) => [row.key, row])),
    mode = OWNER_PROGRESS_MODES.includes(options.mode) ? options.mode : "full",
    variant = options.variant === "holdout" ? "holdout" : "treatment";
  const launch = evaluateLaunch(facts);
  const momentum = computeMomentum(facts, { now, timezone });
  const context = { launch, momentum, state, now };
  const satisfied = MILESTONES.filter((m) => m.done(facts, context) === true).map((m) => m.key);
  const experience = mode === "full" && variant === "treatment" ? "full" : "checklist";
  const milestones = MILESTONES.map((m) => {
    const row = stored.get(m.key);
    const reached = row?.reached_at
      ? new Date(row.reached_at)
      : satisfied.includes(m.key)
        ? now
        : null;
    return {
      key: m.key,
      label: m.label,
      reached_at: reached ? reached.toISOString() : null,
      acknowledged_at: row?.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
    };
  });
  const full = experience === "full";
  return {
    payload: {
      mode,
      variant,
      experience,
      hidden: state.hidden,
      generated_at: now.toISOString(),
      timezone,
      launch,
      goal: full ? selectGoal(facts, context) : null,
      milestones: full ? milestones : [],
      momentum: full
        ? {
            weeks: momentum.weeks,
            current_week_active: momentum.current_week_active,
            freezes_available: momentum.freezes_available,
          }
        : null,
      new_milestones: full
        ? milestones.filter((m) => m.reached_at && !m.acknowledged_at).map((m) => m.key)
        : [],
      review: state.last_review_at
        ? { at: state.last_review_at, decision: state.last_review_decision }
        : null,
    },
    satisfied,
    momentum,
  };
}

// Genuine activity: recorded purchases that were not reversed (reportingPurchase excludes
// refunds, reversal links and expired-only states), never imported history (source
// 'migration' is not a purchase source) and never a practice session (rehearsals are
// fictional state in staff_rehearsals and write no transactions). Deleted customers are
// excluded like every other owner report. There is no marker for test or pilot-seed
// accounts in the data, so they cannot be excluded here (documented limitation).
const genuine = `${reportingPurchase("t")} AND c.deleted_at IS NULL`;
const awardTime = "COALESCE(t.purchase_occurred_at, t.created_at)";
const factsSql = `SELECT
 b.program_type, b.program_json, b.customer_branding_json,
 b.trial_status, b.billing_status, b.trial_started_at, b.trial_ends_at,
 (SELECT count(*)::int FROM rewards r WHERE r.business_id=b.id AND r.active) AS active_rewards,
 (SELECT count(*)::int FROM acquisition_sources s WHERE s.business_id=b.id) AS enrollment_sources,
 (SELECT min(s.created_at) FROM acquisition_sources s WHERE s.business_id=b.id) AS first_source_at,
 (SELECT count(*)::int FROM staff_rehearsals x WHERE x.business_id=b.id AND x.completed_at IS NOT NULL) AS practice_completed,
 (SELECT min(x.completed_at) FROM staff_rehearsals x WHERE x.business_id=b.id AND x.completed_at IS NOT NULL) AS first_practice_at,
 (SELECT count(*)::int FROM staff_users s WHERE s.business_id=b.id AND s.role<>'OWNER' AND (
   EXISTS(SELECT 1 FROM staff_rehearsals x WHERE x.business_id=b.id AND x.staff_id=s.id AND x.completed_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM transactions t JOIN customers c ON c.id=t.customer_id AND c.business_id=t.business_id WHERE t.business_id=b.id AND t.staff_user_id=s.id AND ${genuine}))) AS team_ready,
 (SELECT count(*)::int FROM transactions t JOIN customers c ON c.id=t.customer_id AND c.business_id=t.business_id WHERE t.business_id=b.id AND ${genuine}) AS genuine_awards,
 (SELECT min(${awardTime}) FROM transactions t JOIN customers c ON c.id=t.customer_id AND c.business_id=t.business_id WHERE t.business_id=b.id AND ${genuine}) AS first_award_at,
 (SELECT count(*)::int FROM (
   SELECT t.customer_id FROM transactions t JOIN customers c ON c.id=t.customer_id AND c.business_id=t.business_id
   WHERE t.business_id=b.id AND ${genuine}
   GROUP BY t.customer_id HAVING count(DISTINCT (${awardTime} AT TIME ZONE $2)::date)>=2) rc) AS returning_customers,
 (SELECT count(*)::int FROM redemptions d JOIN customers c ON c.id=d.customer_id AND c.business_id=d.business_id AND c.deleted_at IS NULL WHERE d.business_id=b.id AND d.status='REDEEMED') AS genuine_redemptions,
 (SELECT min(COALESCE(d.redeemed_at,d.created_at)) FROM redemptions d JOIN customers c ON c.id=d.customer_id AND c.business_id=d.business_id AND c.deleted_at IS NULL WHERE d.business_id=b.id AND d.status='REDEEMED') AS first_redemption_at,
 (SELECT count(*)::int FROM customers c WHERE c.business_id=b.id AND c.deleted_at IS NULL) AS active_customers,
 (SELECT count(*)::int FROM growth_measurement_reports m WHERE m.business_id=b.id
   AND m.payload#>>'{results,measurement,state}' IN ('insufficient_sample','positive_difference','negative_difference','inconclusive')) AS campaigns_measured,
 (SELECT count(*)::int FROM native_wallet_passes p WHERE p.business_id=b.id AND p.revoked_at IS NULL) AS wallet_passes,
 EXISTS(SELECT 1 FROM merchant_pilots p WHERE p.business_id=b.id AND p.status IN ('active','completed')) AS pilot,
 COALESCE((SELECT array_agg(DISTINCT to_char(date_trunc('week', ${awardTime} AT TIME ZONE $2),'YYYY-MM-DD'))
   FROM transactions t JOIN customers c ON c.id=t.customer_id AND c.business_id=t.business_id WHERE t.business_id=b.id AND ${genuine}),'{}') AS award_weeks,
 COALESCE((SELECT array_agg(DISTINCT w) FROM (
   SELECT to_char(date_trunc('week', created_at AT TIME ZONE $2),'YYYY-MM-DD') AS w FROM service_cases WHERE business_id=b.id
   UNION ALL SELECT to_char(date_trunc('week', created_at AT TIME ZONE $2),'YYYY-MM-DD') FROM growth_message_outbox WHERE business_id=b.id AND status IN ('failed','uncertain')
   UNION ALL SELECT to_char(date_trunc('week', created_at AT TIME ZONE $2),'YYYY-MM-DD') FROM lifecycle_message_outbox WHERE business_id=b.id AND status IN ('failed','uncertain')) x),'{}') AS todo_weeks
 FROM businesses b WHERE b.id=$1`;

/** @param {Date | string | number | null | undefined} value */
const iso = (value) => (value ? new Date(value).toISOString() : null);
/**
 * Gathers the facts for one business. Runs under the caller's database context (the
 * owner's tenant for requests, runInTenant for jobs), so RLS applies to every table.
 * @param {OwnerProgressQuery} query
 * @param {string} businessId
 * @param {string} [timezone]
 */
export async function loadOwnerProgressFacts(query, businessId, timezone = "America/Guatemala") {
  const { rows } = await query(factsSql, [businessId, timezone]);
  const row = rows[0];
  if (!row) throw notFound("Negocio no disponible.");
  const business = { program_type: row.program_type, program_json: row.program_json };
  const branding = row.customer_branding_json ?? {};
  const lifecycle = row.program_json?.lifecycle ?? {};
  return {
    program_configured: programRuleConfigured(business),
    active_rewards: Number(row.active_rewards) || 0,
    enrollment_sources: Number(row.enrollment_sources) || 0,
    first_source_at: iso(row.first_source_at),
    branded_qr_enabled: branding.qr_logo_enabled === true,
    practice_completed: Number(row.practice_completed) || 0,
    first_practice_at: iso(row.first_practice_at),
    team_ready: Number(row.team_ready) || 0,
    genuine_awards: Number(row.genuine_awards) || 0,
    first_award_at: iso(row.first_award_at),
    returning_customers: Number(row.returning_customers) || 0,
    genuine_redemptions: Number(row.genuine_redemptions) || 0,
    first_redemption_at: iso(row.first_redemption_at),
    active_customers: Number(row.active_customers) || 0,
    automation_live: lifecycle.birthday_enabled === true || lifecycle.winback_enabled === true,
    campaigns_measured: Number(row.campaigns_measured) || 0,
    wallet_passes: Number(row.wallet_passes) || 0,
    pos_connected:
      row.program_json?.pos_integration?.enabled === true &&
      row.program_json?.external_awards?.enabled === true,
    pilot: row.pilot === true,
    award_weeks: Array.isArray(row.award_weeks) ? row.award_weeks : [],
    todo_weeks: Array.isArray(row.todo_weeks) ? row.todo_weeks : [],
    // Trial facts (docs/product/2026-11-25-self-serve-trial.md, section 9): activation is
    // read as milestones reached before trial_ends_at. Legacy businesses report "none".
    trial: {
      status: String(row.trial_status ?? "none"),
      billing_status: String(row.billing_status ?? "none"),
      started_at: iso(row.trial_started_at),
      ends_at: iso(row.trial_ends_at),
    },
  };
}

/** @param {OwnerProgressInjected} [injected] */
export async function loadOwnerProgressSettings(injected = {}) {
  const read = injected.getSettings ?? (() => PlatformSettingsRepo.getOwnerProgress());
  return resolveOwnerProgressSettings(await read());
}

const uuid = z.guid();
/**
 * @param {OwnerProgressQuery} query
 * @param {string} businessId
 * @returns {Promise<OwnerProgressBusinessRow>}
 */
async function businessRow(query, businessId) {
  if (!uuid.safeParse(businessId).success) throw notFound("Negocio no disponible.");
  const { rows } = await query(
    "SELECT id,name,program_json,owner_progress_variant FROM businesses WHERE id=$1",
    [businessId],
  );
  if (!rows[0]) throw notFound("Negocio no disponible.");
  return rows[0];
}
/**
 * "Exposed" means the owner already used the full experience: an acknowledged
 * milestone, a chosen or dismissed goal, a review, or a visibility change (the latter
 * three all create the owner_progress_state row). Milestone rows alone do not count:
 * they are recorded for every variant.
 * @param {OwnerProgressQuery} query
 * @param {string} businessId
 */
async function wasExposed(query, businessId) {
  const { rows } = await query(
    `SELECT (EXISTS(SELECT 1 FROM owner_progress_state WHERE business_id=$1)
      OR EXISTS(SELECT 1 FROM owner_progress_milestones WHERE business_id=$1 AND acknowledged_at IS NOT NULL)) AS exposed`,
    [businessId],
  );
  return rows[0]?.exposed === true;
}
/**
 * Variant rule (design doc, "Modes and measurement"):
 * 1. A variant stored on the business row is final; it is never reassigned, whatever
 *    the holdout share becomes later.
 * 2. While `holdout_pct` is 0 nothing is stored and every business is implicitly
 *    `treatment`. Storing "treatment" at 0% would make a share set later apply only to
 *    businesses never read before, which defeats the measurement plan.
 * 3. When `holdout_pct` > 0 and the business has no stored variant, a business already
 *    exposed to the full experience is stored as `treatment` (it has already seen it);
 *    a business never exposed gets the deterministic hash against the current share.
 * @param {OwnerProgressQuery} query
 * @param {OwnerProgressBusinessRow} business
 * @param {OwnerProgressSettings} settings
 */
async function ensureVariant(query, business, settings) {
  if (business.owner_progress_variant) return business.owner_progress_variant;
  if (!(Number(settings.holdout_pct) > 0)) return "treatment";
  const variant = (await wasExposed(query, business.id))
    ? "treatment"
    : assignOwnerProgressVariant(business.id, settings.holdout_pct);
  const { rows } = await query(
    "UPDATE businesses SET owner_progress_variant=$2 WHERE id=$1 AND owner_progress_variant IS NULL RETURNING owner_progress_variant",
    [business.id, variant],
  );
  return rows[0]?.owner_progress_variant ?? variant;
}
/**
 * @param {OwnerProgressQuery} query
 * @param {string} businessId
 * @returns {Promise<OwnerProgressStateRow | null>}
 */
async function readState(query, businessId) {
  const { rows } = await query("SELECT * FROM owner_progress_state WHERE business_id=$1", [
    businessId,
  ]);
  return rows[0] ?? null;
}
/**
 * @param {OwnerProgressQuery} query
 * @param {string} businessId
 * @returns {Promise<OwnerProgressMilestoneRow[]>}
 */
async function readStored(query, businessId) {
  const { rows } = await query(
    "SELECT key,reached_at,acknowledged_at FROM owner_progress_milestones WHERE business_id=$1",
    [businessId],
  );
  return rows;
}
/**
 * @param {OwnerProgressQuery} query
 * @param {string} businessId
 * @param {string[]} keys
 * @param {Date} now
 */
async function recordMilestones(query, businessId, keys, now) {
  if (!keys.length) return;
  await query(
    `INSERT INTO owner_progress_milestones(business_id,key,reached_at)
     SELECT $1,k,$3 FROM unnest($2::text[]) AS k ON CONFLICT (business_id,key) DO NOTHING`,
    [businessId, keys, now],
  );
}
/**
 * @param {OwnerProgressQuery} query
 * @param {string} businessId
 * @param {Record<string, unknown>} patch column values to set
 * @param {Date} now
 */
async function upsertState(query, businessId, patch, now) {
  const columns = Object.keys(patch);
  const sets = columns.map((c, i) => `${c}=$${i + 3}`).join(",");
  const { rows } = await query(
    `INSERT INTO owner_progress_state(business_id,${columns.join(",")},updated_at)
     VALUES($1,${columns.map((_, i) => `$${i + 3}`).join(",")},$2)
     ON CONFLICT (business_id) DO UPDATE SET ${sets},updated_at=$2 RETURNING *`,
    [businessId, now, ...columns.map((c) => patch[c])],
  );
  return rows[0];
}

/**
 * Evaluates one business, persists newly reached milestones (first-reached time only),
 * stores the variant when the holdout rule says so (see ensureVariant), and returns
 * the API payload.
 * @param {{businessId: string, settings?: {mode:string,holdout_pct:number}, now?: Date}} options
 * @param {OwnerProgressInjected} [injected]
 */
export async function getOwnerProgress(options, injected = {}) {
  const query = injected.query ?? dbQuery,
    now = options.now ?? new Date(),
    settings = options.settings ?? (await loadOwnerProgressSettings(injected));
  if (settings.mode === "off") throw notFound("Tu progreso no está disponible.", "NOT_FOUND");
  const business = await businessRow(query, options.businessId);
  const variant = await ensureVariant(query, business, settings);
  const timezone = businessRegion(business).timezone;
  const [facts, stateRow, stored] = [
    await loadOwnerProgressFacts(query, business.id, timezone),
    await readState(query, business.id),
    await readStored(query, business.id),
  ];
  const first = buildOwnerProgress(facts, {
    mode: settings.mode,
    variant,
    now,
    timezone,
    state: stateRow,
    stored,
  });
  // Milestones are facts: record first-reached times for every variant (the holdout
  // payload simply does not show them), so time-to-milestone can be compared later.
  const missing = first.satisfied.filter((key) => !stored.some((row) => row.key === key));
  await recordMilestones(query, business.id, missing, now);
  if (stateRow && Number(stateRow.freezes_used) !== first.momentum.frozen_weeks)
    await upsertState(query, business.id, { freezes_used: first.momentum.frozen_weeks }, now);
  const refreshed = missing.length ? await readStored(query, business.id) : stored;
  return buildOwnerProgress(facts, {
    mode: settings.mode,
    variant,
    now,
    timezone,
    state: stateRow,
    stored: refreshed,
  }).payload;
}

export const OwnerProgressAcknowledgeSchema = z
  .object({
    keys: z
      .array(z.enum(/** @type {[string, ...string[]]} */ (MILESTONE_KEYS)))
      .min(1)
      .max(40),
  })
  .strict();
export const OwnerProgressGoalSchema = z
  .object({
    key: z.enum(/** @type {[string, ...string[]]} */ (GOAL_KEYS)).optional(),
    dismiss: z.enum(/** @type {[string, ...string[]]} */ (GOAL_KEYS)).optional(),
  })
  .strict()
  .refine((v) => (v.key ? 1 : 0) + (v.dismiss ? 1 : 0) === 1, {
    message: "Indica una meta para elegir o una para descartar.",
  });
export const OwnerProgressReviewSchema = z
  .object({ decision: z.enum(["keep", "adjust"]), note: z.string().trim().max(500).optional() })
  .strict();
export const OwnerProgressVisibilitySchema = z.object({ hidden: z.boolean() }).strict();

/** @param {OwnerProgressActionOptions} options */
const actorMeta = (options) => ({
  businessId: options.businessId,
  actor: options.staffId ?? null,
  ip: options.ip ?? null,
  ua: options.ua ?? null,
});
/**
 * @param {OwnerProgressInjected} injected
 * @param {OwnerProgressActionOptions} options
 * @param {string} action
 * @param {Record<string, unknown>} meta
 */
async function audit(injected, options, action, meta) {
  const log = injected.audit ?? AuditRepo.log;
  const a = actorMeta(options);
  await log({
    id: randomUUID(),
    business_id: a.businessId,
    actor_type: "STAFF",
    actor_id: a.actor,
    action,
    ip: a.ip,
    ua: a.ua,
    meta,
  }).catch(() => {});
}
/**
 * @param {OwnerProgressActionOptions} options
 * @param {OwnerProgressInjected} injected
 */
async function requireAvailable(options, injected) {
  const settings = options.settings ?? (await loadOwnerProgressSettings(injected));
  if (settings.mode === "off") throw notFound("Tu progreso no está disponible.", "NOT_FOUND");
  return settings;
}

/**
 * Marks milestones acknowledged (idempotent; unknown or unreached keys are ignored).
 * @param {OwnerProgressActionOptions & { keys?: unknown }} options `keys` is the request body field
 * @param {OwnerProgressInjected} [injected]
 */
export async function acknowledgeOwnerProgressMilestones(options, injected = {}) {
  const query = injected.query ?? dbQuery,
    now = options.now ?? new Date(),
    settings = await requireAvailable(options, injected);
  const keys = OwnerProgressAcknowledgeSchema.parse({ keys: options.keys }).keys;
  const { rows } = await query(
    `UPDATE owner_progress_milestones SET acknowledged_at=COALESCE(acknowledged_at,$3)
     WHERE business_id=$1 AND key=ANY($2::text[]) RETURNING key`,
    [options.businessId, keys, now],
  );
  return {
    ok: true,
    acknowledged: rows.map((/** @type {{ key: string }} */ r) => r.key),
    progress: await getOwnerProgress({ ...options, settings, now }, injected),
  };
}

/**
 * Chooses a goal or dismisses one (dismissed goals are not re-suggested for 30 days).
 * @param {OwnerProgressActionOptions & { key?: unknown, dismiss?: unknown }} options body fields are validated here
 * @param {OwnerProgressInjected} [injected]
 */
export async function setOwnerProgressGoal(options, injected = {}) {
  const query = injected.query ?? dbQuery,
    now = options.now ?? new Date(),
    settings = await requireAvailable(options, injected);
  const input = OwnerProgressGoalSchema.parse({
    ...(options.key ? { key: options.key } : {}),
    ...(options.dismiss ? { dismiss: options.dismiss } : {}),
  });
  const current = normalizeState(await readState(query, options.businessId));
  const dismissKey = input.dismiss;
  const patch = input.key
    ? { current_goal: input.key }
    : dismissKey
      ? {
          current_goal: current.current_goal === dismissKey ? null : current.current_goal,
          dismissed_goals: JSON.stringify({
            ...current.dismissed_goals,
            [dismissKey]: now.toISOString(),
          }),
        }
      : null;
  // The schema guarantees exactly one of key/dismiss; this keeps the narrowing explicit.
  if (!patch) throw badRequest("Indica una meta para elegir o una para descartar.");
  await upsertState(query, options.businessId, patch, now);
  await audit(injected, options, "owner_progress.goal", input);
  return { ok: true, progress: await getOwnerProgress({ ...options, settings, now }, injected) };
}

/**
 * Records an explicit program review ("Mantener"/"Ajustar") and grants primera_revision.
 * @param {OwnerProgressActionOptions & { decision?: unknown, note?: unknown }} options body fields are validated here
 * @param {OwnerProgressInjected} [injected]
 */
export async function recordOwnerProgressReview(options, injected = {}) {
  const query = injected.query ?? dbQuery,
    now = options.now ?? new Date(),
    settings = await requireAvailable(options, injected);
  const input = OwnerProgressReviewSchema.parse({
    decision: options.decision,
    ...(options.note ? { note: options.note } : {}),
  });
  await upsertState(
    query,
    options.businessId,
    { last_review_at: now, last_review_decision: input.decision },
    now,
  );
  await recordMilestones(query, options.businessId, ["primera_revision"], now);
  await audit(injected, options, "owner_progress.review", {
    decision: input.decision,
    ...(input.note ? { note: input.note } : {}),
  });
  return { ok: true, progress: await getOwnerProgress({ ...options, settings, now }, injected) };
}

/**
 * Hides or shows the whole experience; the choice persists.
 * @param {OwnerProgressActionOptions & { hidden?: unknown }} options `hidden` is the request body field
 * @param {OwnerProgressInjected} [injected]
 */
export async function setOwnerProgressVisibility(options, injected = {}) {
  const query = injected.query ?? dbQuery,
    now = options.now ?? new Date(),
    settings = await requireAvailable(options, injected);
  const input = OwnerProgressVisibilitySchema.parse({ hidden: options.hidden });
  await upsertState(query, options.businessId, { hidden: input.hidden }, now);
  await audit(injected, options, "owner_progress.visibility", input);
  return { ok: true, progress: await getOwnerProgress({ ...options, settings, now }, injected) };
}

/**
 * One line for the Monday owner brief: milestones reached in the last 7 days and the
 * current goal. Null when the mode is off, the business is a holdout (launch path
 * only), the owner hid the card, or there is nothing to say. Runs inside the brief's
 * tenant context; the caller supplies the business row and its client.
 * @param {OwnerProgressQuery} query
 * @param {{ id: string }} business
 * @param {Date} now
 * @param {OwnerProgressInjected} [injected]
 */
export async function ownerProgressBriefLine(query, business, now, injected = {}) {
  const settings = await loadOwnerProgressSettings(injected);
  if (settings.mode !== "full") return null;
  const progress = await getOwnerProgress(
    { businessId: business.id, settings, now },
    { ...injected, query },
  );
  if (progress.experience !== "full" || progress.hidden) return null;
  const since = now.getTime() - 7 * 86400000;
  const recent = progress.milestones.filter(
    (m) => m.reached_at && new Date(m.reached_at).getTime() >= since,
  );
  if (!recent.length && !progress.goal) return null;
  const parts = [];
  if (recent.length)
    parts.push(
      `${recent.length === 1 ? "Logro de la semana" : "Logros de la semana"}: ${recent.map((m) => m.label).join(", ")}`,
    );
  if (progress.goal)
    parts.push(
      `Meta actual: ${progress.goal.label}${progress.goal.progress ? ` (${progress.goal.progress.current}/${progress.goal.progress.target})` : ""}`,
    );
  if (progress.momentum?.weeks)
    parts.push(
      `Impulso: ${progress.momentum.weeks} ${progress.momentum.weeks === 1 ? "semana" : "semanas"}`,
    );
  return {
    text: `Tu progreso · ${parts.join(" · ")}.`,
    milestones: recent.map((m) => ({ key: m.key, label: m.label, reached_at: m.reached_at })),
    goal: progress.goal,
    momentum: progress.momentum,
  };
}

/** @param {unknown} input super API body, validated by OwnerProgressSettingsSchema */
export function assertOwnerProgressSettings(input) {
  const parsed = OwnerProgressSettingsSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Revisa el modo y el porcentaje de control.");
  return parsed.data;
}
