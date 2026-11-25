// Pure trial math and Spanish copy for the self-serve 14-day trial. No database here:
// the entitlement middleware, the owner banner endpoint, the daily job and the super
// console all derive the same answer from a `businesses` row and a clock.
// Design of record: docs/product/2026-11-25-self-serve-trial.md (sections 4.2, 4.3, 7.3).
import { DateTime } from "luxon";

export const DEFAULT_TRIAL_TIMEZONE = "America/Guatemala";
/** Where the owner app sends a locked owner ("Plan y facturación"). */
export const TRIAL_UPGRADE_URL = "/negocio/#plan";
/** The banner turns urgent when this many local calendar days (or fewer) remain. */
export const TRIAL_EXPIRING_DAYS = 3;
/** Reminder thresholds in local calendar days left: day 10 and day 13 of a 14-day trial. */
export const TRIAL_REMINDER_DAYS = Object.freeze({ day10: 4, day13: 1 });
/** Days before `purge_after` at which the last-call email goes out. */
export const TRIAL_PURGE_WARNING_DAYS = 7;

/** @typedef {"active" | "expiring" | "locked" | "converted" | "none"} TrialStatus */
/**
 * The columns this module reads from a `businesses` row (all added by migration
 * 2026-11-26-a; legacy rows carry the defaults 'none'/'none').
 * @typedef {{
 *   trial_status?: string | null,
 *   billing_status?: string | null,
 *   trial_started_at?: Date | string | null,
 *   trial_ends_at?: Date | string | null,
 *   locked_at?: Date | string | null,
 *   purge_after?: Date | string | null
 * }} TrialColumns
 */
/**
 * @typedef {{
 *   status: TrialStatus,
 *   locked: boolean,
 *   pending_lock: boolean,
 *   days_left: number | null,
 *   started_at: string | null,
 *   ends_at: string | null,
 *   locked_at: string | null,
 *   purge_after: string | null,
 *   billing_status: string,
 *   trial_status: string
 * }} TrialState
 */

/** @param {Date | string | number} value */
function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid trial date");
  return date;
}

/** @param {Date | string | number | null | undefined} value */
const iso = (value) => (value ? toDate(value).toISOString() : null);

/**
 * The trial end: the same local wall-clock time `days` calendar days after the start, in
 * the business timezone (so a DST change in a zone that observes it never shortens or
 * lengthens the trial by an hour; Guatemala has no DST, where this equals +days*24h).
 * @param {Date | string | number} startedAt
 * @param {number} days
 * @param {string} [timezone]
 */
export function computeTrialEnd(startedAt, days, timezone = DEFAULT_TRIAL_TIMEZONE) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new RangeError("Invalid days");
  return DateTime.fromJSDate(toDate(startedAt), { zone: timezone }).plus({ days }).toJSDate();
}

/**
 * Local calendar days from `now` to the trial end, in the business timezone, never
 * negative: 0 on the last day (or once the end has passed), 1 the day before ("Mañana
 * termina tu prueba"), 14 on signup day for a 14-day trial.
 * @param {Date | string | number} endsAt
 * @param {Date | string | number} now
 * @param {string} [timezone]
 */
export function trialDaysLeft(endsAt, now, timezone = DEFAULT_TRIAL_TIMEZONE) {
  const end = toDate(endsAt),
    at = toDate(now);
  if (at.getTime() >= end.getTime()) return 0;
  const endDay = DateTime.fromJSDate(end, { zone: timezone }).startOf("day");
  const today = DateTime.fromJSDate(at, { zone: timezone }).startOf("day");
  return Math.max(0, Math.round(endDay.diff(today, "days").days));
}

/**
 * Derives the trial state the product reasons about. `billing_status` is the access
 * state and wins: a paid or legacy business is never locked, whatever its history.
 * A trialing business past `trial_ends_at` reports `locked` even before the daily job
 * has written the lock (`pending_lock`), so the soft lock applies from the end instant.
 * @param {TrialColumns | null | undefined} business
 * @param {{ now?: Date | string | number, timezone?: string }} [options]
 * @returns {TrialState}
 */
export function trialState(business, { now = new Date(), timezone = DEFAULT_TRIAL_TIMEZONE } = {}) {
  const billing = String(business?.billing_status ?? "none");
  const trial = String(business?.trial_status ?? "none");
  const endsAt = business?.trial_ends_at ? toDate(business.trial_ends_at) : null;
  const base = {
    pending_lock: false,
    days_left: /** @type {number | null} */ (null),
    started_at: iso(business?.trial_started_at),
    ends_at: iso(endsAt),
    locked_at: iso(business?.locked_at),
    purge_after: iso(business?.purge_after),
    billing_status: billing,
    trial_status: trial,
  };
  if (billing === "active" || billing === "past_due" || billing === "canceled")
    return { ...base, status: "converted", locked: false };
  if (billing === "locked") return { ...base, status: "locked", locked: true, days_left: 0 };
  if (billing === "trialing" && endsAt) {
    const at = toDate(now);
    if (at.getTime() >= endsAt.getTime())
      return { ...base, status: "locked", locked: true, pending_lock: true, days_left: 0 };
    const daysLeft = trialDaysLeft(endsAt, at, timezone);
    return {
      ...base,
      status: daysLeft <= TRIAL_EXPIRING_DAYS ? "expiring" : "active",
      locked: false,
      days_left: daysLeft,
    };
  }
  if (trial === "converted") return { ...base, status: "converted", locked: false };
  return { ...base, status: "none", locked: false };
}

/**
 * Formats an instant as a Guatemalan long date in the business timezone ("9 de diciembre de 2026").
 * @param {Date | string | number | null | undefined} value
 * @param {string} [timezone]
 */
export function formatTrialDate(value, timezone = DEFAULT_TRIAL_TIMEZONE) {
  if (!value) return "";
  return DateTime.fromJSDate(toDate(value), { zone: timezone })
    .setLocale("es-GT")
    .toFormat("d 'de' LLLL 'de' yyyy");
}

/** Spanish copy shared by the API (banner, lock screen, error bodies) and the emails. */
export const TRIAL_COPY = Object.freeze({
  /** @param {number} daysLeft */
  banner: (daysLeft) =>
    daysLeft <= 0
      ? "Prueba gratis · termina hoy"
      : daysLeft === 1
        ? "Prueba gratis · te queda 1 día"
        : `Prueba gratis · te quedan ${daysLeft} días`,
  banner_cta: "Elegir plan",
  locked_title: "Tu prueba terminó",
  locked_body:
    "Tu prueba de 14 días terminó. Puedes seguir viendo clientes, reportes y exportar tus datos; para volver a sumar puntos y canjear recompensas elige un plan.",
  locked_still_works: ["Ver clientes", "Ver reportes", "Exportar clientes"],
  locked_error_owner: "Tu prueba terminó. Elige un plan para seguir operando.",
  locked_error_staff:
    "El programa está en pausa: la prueba del negocio terminó. Pide al dueño que elija un plan.",
  /** @param {string} date */
  retention: (date) =>
    date ? `Conservaremos tus datos hasta el ${date}.` : "Conservaremos tus datos 30 días.",
  upgrade_pending: "Pronto podrás pagar en línea; mientras tanto escríbenos para activar tu plan.",
});
