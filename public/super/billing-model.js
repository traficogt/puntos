// Pure helpers for the super-console "Suscripciones y cobro" section (wave 2 of
// docs/product/2026-11-25-self-serve-trial.md, §3.3, §7.4): status filters and labels over
// GET /api/super/billing/subscriptions, event rows from GET /api/super/billing/events, money in
// minor units and the PUT /api/super/billing/catalog payload. No DOM, tested in Node.

/** @typedef {import("./types.js").SuperBillingSubscriptionRow} SuperBillingSubscriptionRow */
/** @typedef {import("./types.js").SuperBillingEvent} SuperBillingEvent */
/** @typedef {import("./types.js").SuperBillingCatalog} SuperBillingCatalog */
/** @typedef {import("./types.js").SuperPlanAmounts} SuperPlanAmounts */
/** @typedef {import("./types.js").SuperPriceIds} SuperPriceIds */
/** @typedef {"all" | "active" | "past_due" | "canceled" | "manual" | "trial"} SubscriptionFilter */

/** @type {Array<[SubscriptionFilter, string]>} */
export const SUBSCRIPTION_FILTERS = [
  ["all", "Todas"],
  ["active", "Activas"],
  ["past_due", "Pago pendiente"],
  ["canceled", "Canceladas"],
  ["manual", "Manuales"],
  ["trial", "En prueba"],
];
/** @type {ReadonlyArray<"EMPRENDEDOR" | "NEGOCIO" | "EMPRESA">} */
export const BILLING_PLANS = ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"];
/** @type {Record<string, string>} */
const STATUS_LABELS = {
  none: "Sin suscripción",
  trial: "En prueba",
  active: "Activa",
  past_due: "Pago pendiente",
  canceled: "Cancelada",
  manual: "Manual (acuerdo directo)",
};
/** @type {Record<string, string>} */
const EVENT_LABELS = {
  payment_succeeded: "Pago exitoso",
  payment_failed: "Pago rechazado",
  subscription_created: "Suscripción creada",
  subscription_updated: "Suscripción actualizada",
  subscription_past_due: "Pago pendiente",
  subscription_canceled: "Suscripción cancelada",
  refund_created: "Reembolso",
  dispute_opened: "Disputa",
  "subscription.activated": "Plan activado",
  "subscription.canceled": "Plan cancelado",
  checkout_created: "Pago iniciado",
  checkout_completed: "Pago completado",
  checkout_expired: "Pago vencido",
};
/** @type {Record<string, string>} */
const CURRENCY_PREFIX = { USD: "USD ", GTQ: "Q" };

/** @param {string | null | undefined} status */
export function subscriptionStatusLabel(status) {
  const key = String(status || "none").toLowerCase();
  return STATUS_LABELS[key] || `Estado: ${key}`;
}

/** @param {string | null | undefined} type */
export function billingEventLabel(type) {
  const key = String(type || "").trim();
  return EVENT_LABELS[key] || key || "Evento";
}

/**
 * "USD 79.00" / "Q600.00" from minor units (cents); "—" when absent. Fixed en-US grouping so
 * the output does not depend on the browser's ICU data.
 * @param {number | null | undefined} minor
 * @param {string | null | undefined} currency
 */
export function formatMinor(minor, currency) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "—";
  const code = String(currency || "USD").toUpperCase();
  const prefix = CURRENCY_PREFIX[code] ?? `${code} `;
  const sign = minor < 0 ? "−" : "";
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(Math.round(minor)) / 100);
  return `${sign}${prefix}${text}`;
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

/** @param {SuperBillingSubscriptionRow} row @param {SubscriptionFilter} filter */
export function subscriptionFilterMatches(row, filter) {
  const status = String(row.status || "none").toLowerCase();
  if (filter === "all") return status !== "none";
  return status === filter;
}

/**
 * Past-due first, then the soonest period end.
 * @param {SuperBillingSubscriptionRow[]} rows @param {SubscriptionFilter} filter
 */
export function filterSubscriptions(rows, filter) {
  const rank = (/** @type {SuperBillingSubscriptionRow} */ row) =>
    row.status === "past_due" ? 0 : row.status === "active" ? 1 : row.status === "canceled" ? 2 : 3;
  const when = (/** @type {string | null | undefined} */ value) => {
    const at = value ? Date.parse(value) : NaN;
    return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
  };
  return rows
    .filter((row) => subscriptionFilterMatches(row, filter))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        when(a.cancel_at || a.current_period_end) - when(b.cancel_at || b.current_period_end),
    );
}

/** @param {SuperBillingSubscriptionRow[]} rows @returns {Record<SubscriptionFilter, number>} */
export function subscriptionCounts(rows) {
  return /** @type {Record<SubscriptionFilter, number>} */ (
    Object.fromEntries(
      SUBSCRIPTION_FILTERS.map(([key]) => [
        key,
        rows.filter((row) => subscriptionFilterMatches(row, key)).length,
      ]),
    )
  );
}

/** One-line money summary: "Impulsa · 2 sucursales × USD 79.00 = USD 158.00 al mes". @param {SuperBillingSubscriptionRow} row */
export function subscriptionAmountLine(row) {
  const quantity = Math.max(1, Number(row.quantity) || 1);
  const total = row.monthly_total_minor == null ? NaN : Number(row.monthly_total_minor);
  if (!Number.isFinite(total))
    return `${row.plan || "—"} · ${quantity} ${quantity === 1 ? "sucursal" : "sucursales"}`;
  const unit = formatMinor(Math.round(total / quantity), row.currency);
  return `${row.plan || "—"} · ${quantity} ${quantity === 1 ? "sucursal" : "sucursales"} × ${unit} = ${formatMinor(total, row.currency)} al mes`;
}

/** Dates relevant to the status. @param {SuperBillingSubscriptionRow} row */
export function subscriptionDatesLine(row) {
  const parts = [];
  if (row.provider) parts.push(`Proveedor ${row.provider}`);
  if (row.status === "past_due" && row.past_due_since)
    parts.push(`Rechazado desde ${formatDay(row.past_due_since)}`);
  if (row.status === "canceled" && (row.cancel_at || row.current_period_end))
    parts.push(`Termina ${formatDay(row.cancel_at || row.current_period_end)}`);
  else if (row.current_period_end) parts.push(`Período hasta ${formatDay(row.current_period_end)}`);
  return parts.join(" · ");
}

/** Whether the super console may cancel this subscription now. @param {SuperBillingSubscriptionRow} row */
export function canCancelSubscription(row) {
  const status = String(row.status || "").toLowerCase();
  return (status === "active" || status === "past_due") && row.provider !== "manual";
}

/** Oldest last; failed payments keep their sign. @param {SuperBillingEvent[]} events */
export function sortBillingEvents(events) {
  const when = (/** @type {string | null | undefined} */ value) => {
    const at = value ? Date.parse(value) : NaN;
    return Number.isFinite(at) ? at : 0;
  };
  return [...events].sort((a, b) => when(b.occurred_at) - when(a.occurred_at));
}

/**
 * The provider price ids, whichever shape the catalog carries: top-level `price_ids`
 * (wave 2 contract) or `providers.recurrente.price_ids` (platform setting).
 * @param {SuperBillingCatalog | null | undefined} catalog
 * @returns {{ USD: SuperPriceIds, GTQ: SuperPriceIds }}
 */
export function catalogPriceIds(catalog) {
  const top = catalog?.price_ids || null;
  const nested = catalog?.providers?.recurrente?.price_ids || null;
  return {
    USD: { ...(nested?.USD || {}), ...(top?.USD || {}) },
    GTQ: { ...(nested?.GTQ || {}), ...(top?.GTQ || {}) },
  };
}

/**
 * Whole positive amounts (list prices are integers in both currencies); null when the form is
 * empty, an error string when partially or badly filled.
 * @param {Record<string, string>} input raw field values by plan
 * @returns {{ amounts: SuperPlanAmounts | null, error: string | null }}
 */
export function parsePlanAmounts(input) {
  /** @type {SuperPlanAmounts} */
  const amounts = {};
  let filled = 0;
  for (const plan of BILLING_PLANS) {
    const raw = String(input[plan] ?? "").trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 1_000_000)
      return {
        amounts: null,
        error: `El monto de ${plan} debe ser un entero entre 1 y 1,000,000.`,
      };
    amounts[plan] = value;
    filled += 1;
  }
  if (filled === 0) return { amounts: null, error: null };
  if (filled !== BILLING_PLANS.length)
    return { amounts: null, error: "Escribe los tres montos en quetzales o deja los tres vacíos." };
  return { amounts, error: null };
}

/**
 * Body for PUT /api/super/billing/catalog (strict schema: usd, gtq, gtq_reference,
 * published_at, providers). USD stays as published; the provider price ids pass through so a
 * GTQ edit never drops them.
 * @param {SuperBillingCatalog} current
 * @param {{ gtq: Record<string, string>, rate: string, as_of: string }} form
 * @returns {{ payload: Record<string, unknown> | null, error: string | null }}
 */
export function buildCatalogPayload(current, form) {
  const gtq = parsePlanAmounts(form.gtq);
  if (gtq.error) return { payload: null, error: gtq.error };
  const rate = String(form.rate ?? "").trim();
  const asOf = String(form.as_of ?? "").trim();
  /** @type {{ rate: number, as_of: string } | null} */
  let reference = null;
  if (rate || asOf) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0 || value > 1000)
      return { payload: null, error: "La tasa de referencia debe ser un número mayor que 0." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf))
      return {
        payload: null,
        error: "La fecha de la tasa de referencia debe tener el formato AAAA-MM-DD.",
      };
    reference = { rate: Math.round(value * 10000) / 10000, as_of: asOf };
  }
  /** @type {SuperPlanAmounts} */
  const usd = {};
  for (const plan of BILLING_PLANS) {
    const value = Number(current.usd?.[plan]);
    if (!Number.isInteger(value) || value < 1)
      return {
        payload: null,
        error: "El catálogo publicado en USD no se pudo leer; recarga la página.",
      };
    usd[plan] = value;
  }
  const ids = catalogPriceIds(current);
  const stripe = current.providers?.stripe?.price_ids?.USD || {};
  /** @type {Record<string, unknown>} */
  const payload = {
    usd,
    gtq: gtq.amounts,
    gtq_reference: reference,
    providers: {
      recurrente: { price_ids: { USD: { ...ids.USD }, GTQ: { ...ids.GTQ } } },
      stripe: { price_ids: { USD: { ...stripe } } },
    },
  };
  if (current.published_at && /^\d{4}-\d{2}-\d{2}$/.test(current.published_at))
    payload.published_at = current.published_at;
  return { payload, error: null };
}

/**
 * Spanish notice for an endpoint the server does not serve (404) or cannot serve because the
 * provider is unconfigured (503 BILLING_UNAVAILABLE); null for other errors.
 * @param {{ status?: number, code?: string } | null | undefined} error
 */
export function billingUnavailableNotice(error) {
  if (!error) return null;
  if (error.status === 404) return "El servidor aún no expone esta parte del API de cobro (ola 2).";
  if (error.status === 503 || error.code === "BILLING_UNAVAILABLE")
    return "El proveedor de cobro (Recurrente) no está configurado en este servidor: faltan la clave o el secreto de webhooks.";
  return null;
}
