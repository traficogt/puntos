// Pure helpers for the super-console "Pruebas" section: filters, days left and labels over
// the trial/billing columns GET /api/super/businesses gains with the self-serve trial
// (docs/product/2026-11-25-self-serve-trial.md §3.1, §7.4). No DOM, tested in Node.

/** @typedef {import("./types.js").SuperBusinessRow} SuperBusinessRow */
/** @typedef {"all" | "active" | "ending" | "locked" | "converted" | "purge"} TrialFilter */

/** @type {Array<[TrialFilter, string]>} */
export const TRIAL_FILTERS = [
  ["all", "Todas"],
  ["active", "En prueba"],
  ["ending", "Vencen en 3 días"],
  ["locked", "Bloqueadas"],
  ["converted", "Convertidas"],
  ["purge", "Por eliminar"],
];
const DAY_MS = 86_400_000;
const ENDING_DAYS = 3;
/** @type {Record<string, string>} */
const SOURCE_LABELS = {
  self_serve: "Autoservicio (/prueba/)",
  internal: "Alta interna",
  super: "Consola super",
  api: "API",
};

/** The server exposes trial columns only once the trial migration and API are deployed. */
/** @param {SuperBusinessRow[]} rows */
export function hasTrialColumns(rows) {
  return rows.some((row) => "trial_status" in row || "billing_status" in row);
}

/** @param {string | null | undefined} value @param {Date} [now] */
export function daysUntil(value, now = new Date()) {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / DAY_MS));
}

/** @param {SuperBusinessRow} row @param {Date} [now] */
export function trialDaysLeft(row, now = new Date()) {
  return daysUntil(row.trial_ends_at, now);
}

/** @param {SuperBusinessRow} row @param {Date} [now] */
export function purgeDaysLeft(row, now = new Date()) {
  return daysUntil(row.purge_after, now);
}

/** @param {SuperBusinessRow} row */
export function isTrialRow(row) {
  return (
    Boolean(row.trial_status && row.trial_status !== "none") ||
    Boolean(row.billing_status && row.billing_status !== "none")
  );
}

/** @param {SuperBusinessRow} row @param {TrialFilter} filter @param {Date} [now] */
export function trialFilterMatches(row, filter, now = new Date()) {
  const active = row.trial_status === "active" && row.billing_status !== "locked";
  switch (filter) {
    case "all":
      return isTrialRow(row);
    case "active":
      return active;
    case "ending": {
      const left = trialDaysLeft(row, now);
      return active && left !== null && left <= ENDING_DAYS;
    }
    case "locked":
      return row.billing_status === "locked";
    case "converted":
      return (
        row.trial_status === "converted" ||
        (row.billing_status === "active" &&
          Boolean(row.trial_status) &&
          row.trial_status !== "none")
      );
    case "purge":
      return row.billing_status === "locked" && Boolean(row.purge_after);
    default:
      return false;
  }
}

/** @param {string | null | undefined} value */
function sortKey(value) {
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

/** Soonest trial end first. @param {SuperBusinessRow[]} rows @param {TrialFilter} filter @param {Date} [now] */
export function filterTrialRows(rows, filter, now = new Date()) {
  return rows
    .filter((row) => trialFilterMatches(row, filter, now))
    .sort((a, b) => sortKey(a.trial_ends_at) - sortKey(b.trial_ends_at));
}

/** @param {SuperBusinessRow[]} rows @param {Date} [now] @returns {Record<TrialFilter, number>} */
export function trialCounts(rows, now = new Date()) {
  return /** @type {Record<TrialFilter, number>} */ (
    Object.fromEntries(
      TRIAL_FILTERS.map(([key]) => [
        key,
        rows.filter((row) => trialFilterMatches(row, key, now)).length,
      ]),
    )
  );
}

/** @param {SuperBusinessRow} row */
export function trialStatusLabel(row) {
  if (row.billing_status === "locked") return "Bloqueada";
  if (
    row.trial_status === "converted" ||
    (row.billing_status === "active" && Boolean(row.trial_status) && row.trial_status !== "none")
  )
    return "Convertida";
  if (row.billing_status === "past_due") return "Pago pendiente";
  if (row.billing_status === "canceled") return "Cancelada";
  if (row.trial_status === "active") return "En prueba";
  if (row.trial_status === "expired") return "Vencida";
  return "Sin prueba";
}

/** @param {SuperBusinessRow} row */
export function trialPhoneLabel(row) {
  const phone = String(row.trial_phone || "");
  return phone ? `Teléfono verificado · ···${phone.slice(-4)}` : "Teléfono sin verificar";
}

/** @param {string | null | undefined} source */
export function signupSourceLabel(source) {
  const key = String(source || "");
  return SOURCE_LABELS[key] || (key ? `Origen: ${key}` : "Origen no registrado");
}

/** @param {string | null | undefined} value */
export function formatDay(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeZone: "America/Guatemala",
  }).format(date);
}

/** @param {SuperBusinessRow} row @param {Date} [now] */
export function trialDatesLine(row, now = new Date()) {
  const parts = [];
  if (row.trial_started_at) parts.push(`Inicio ${formatDay(row.trial_started_at)}`);
  if (row.trial_ends_at) {
    const left = trialDaysLeft(row, now);
    parts.push(
      `Fin ${formatDay(row.trial_ends_at)}${left !== null && row.trial_status === "active" ? ` (${left} ${left === 1 ? "día" : "días"})` : ""}`,
    );
  }
  if (row.locked_at) parts.push(`Bloqueo ${formatDay(row.locked_at)}`);
  if (row.purge_after) {
    const left = purgeDaysLeft(row, now);
    parts.push(
      `Eliminación ${formatDay(row.purge_after)}${left !== null ? ` (${left} ${left === 1 ? "día" : "días"})` : ""}`,
    );
  }
  return parts.join(" · ");
}
