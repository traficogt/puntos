import { sourceHealth, sourceHealthReasons } from "./source-health-model.js";

/**
 * Owner-editable program configuration (businesses.program_json). Only the
 * sections this service family reads are named; other keys stay unknown.
 * @typedef {{
 *   lifecycle?: { minimum_contact_days?: number, [key: string]: unknown } | null,
 *   award_guard?: { max_points_per_tx?: number | null, [key: string]: unknown } | null,
 *   pos_integration?: MerchantPosIntegration | null,
 *   data_health?: { sources?: import("./source-health-model.js").SourceHealthSource[] | null, [key: string]: unknown } | null,
 *   merchant_operating_mode?: { mode?: unknown, until?: unknown, capacity?: unknown } | null,
 *   region?: { country?: unknown, currency?: unknown, timezone?: unknown } | null,
 *   external_awards?: { enabled?: boolean, api_key?: string, [key: string]: unknown } | null,
 *   balance_policy?: { allow_negative_balance_on_refund?: boolean, [key: string]: unknown } | null,
 *   tier_policy?: Record<string, unknown> | null,
 *   currency_confirmation?: { currency?: unknown, confirmed_at?: unknown, staff_id?: string | null } | null,
 *   weekly_owner_brief?: {
 *     channel?: string,
 *     owner_id?: string | null,
 *     destination?: string | null,
 *     settings?: { enabled?: boolean, [key: string]: unknown } | null,
 *     [key: string]: unknown,
 *   } | null,
 *   pending_points_hold_days?: number | string | null,
 *   targeted_offers_enabled?: boolean,
 *   [key: string]: unknown,
 * }} MerchantProgramJson
 */
/**
 * program_json.pos_integration as the POS integration service stores it.
 * @typedef {{
 *   mode?: unknown,
 *   automatic?: boolean,
 *   enabled?: boolean,
 *   last_completed_at?: unknown,
 *   connected_at?: unknown,
 *   pending_receipts?: unknown,
 *   loyverse?: { access_token?: unknown, [key: string]: unknown } | null,
 *   last_sync?: { at?: unknown, pending?: unknown, errors?: unknown, status?: unknown, has_more?: unknown } | null,
 *   [key: string]: unknown,
 * }} MerchantPosIntegration
 */
/**
 * Anything carrying a business's program_json: a businesses row, or a
 * growth_campaigns row joined with b.program_json.
 * @typedef {{ program_json?: MerchantProgramJson | null, [key: string]: unknown }} MerchantBusinessLike
 */
/**
 * Saved audience definition (customer-audience-definition.js); `rules[].field`
 * names the member attribute a rule filters on.
 * @typedef {{ rules?: Array<{ field?: unknown, [key: string]: unknown }> | null, [key: string]: unknown }} MerchantAudienceGroup
 * @typedef {{ include?: MerchantAudienceGroup | null, exclude?: MerchantAudienceGroup | null, [key: string]: unknown }} MerchantAudienceDefinition
 */
/**
 * growth_campaigns.audience_snapshot as stored at creation / preparation.
 * @typedef {{
 *   definition?: MerchantAudienceDefinition | null,
 *   preparation?: unknown,
 *   limit?: unknown,
 *   [key: string]: unknown,
 * }} MerchantAudienceSnapshot
 */

const HOUR = 3600000;
const summaries = {
  integration_paused:
    "La importación automática está pausada. No podemos interpretar la ausencia de compras como inactividad.",
  initial_sync_incomplete: "Todavía no hay una ventana de importación automática completada.",
  sync_stale: "La importación automática lleva más de 24 horas sin completar una ventana.",
  sync_incomplete: "Hay una ventana de importación incompleta.",
  sync_errors: "La última importación registra errores pendientes de revisar.",
  pending_receipts: "Hay ventas pendientes de incorporar.",
  sync_time_invalid: "La fecha de importación no permite comprobar la vigencia de los datos.",
};
/** @param {unknown} value */
function stamp(value) {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
/**
 * @param {MerchantBusinessLike} [business]
 * @param {Date} [now]
 */
export function readinessForBusiness(business = {}, now = new Date()) {
  /** @type {MerchantPosIntegration} */
  const pos = business.program_json?.pos_integration ?? {};
  /** @type {NonNullable<MerchantPosIntegration["last_sync"]>} */
  const sync = pos.last_sync ?? {};
  const source = /** @type {unknown[]} */ (["loyverse", "csv", "api"]).includes(pos.mode)
    ? /** @type {string} */ (pos.mode)
    : "manual";
  const automatic = source === "loyverse" && pos.automatic === true;
  const completed = stamp(pos.last_completed_at);
  // Date.parse(null) is NaN, exactly like Date.parse on a missing stamp.
  const completedAt = completed === null ? NaN : Date.parse(completed);
  /** @type {keyof typeof summaries | keyof typeof sourceHealthReasons | null} */
  let reason = null;
  if (automatic && pos.enabled !== true) reason = "integration_paused";
  else if (pos.enabled === true || automatic) {
    if (
      (Array.isArray(pos.pending_receipts) && pos.pending_receipts.length) ||
      Number(sync.pending) > 0
    )
      reason = "pending_receipts";
    else if (
      Number(sync.errors) > 0 ||
      /** @type {unknown[]} */ (["error", "attention"]).includes(sync.status)
    )
      reason = "sync_errors";
    else if (sync.has_more === true) reason = "sync_incomplete";
    else if (automatic && !completed) reason = "initial_sync_incomplete";
    else if (automatic && completedAt > now.getTime() + 5 * 60000) reason = "sync_time_invalid";
    else if (automatic && now.getTime() - completedAt > 24 * HOUR) reason = "sync_stale";
  }
  const sources = sourceHealth(business.program_json?.data_health?.sources, now);
  const blockedSource = sources.find((item) => item.state === "blocked");
  if (!reason && blockedSource) reason = blockedSource.reason;
  const state = reason ? "blocked" : automatic || sources.length ? "ready" : "recorded_only";
  return {
    state,
    source,
    sources,
    inactivity_allowed: !reason,
    reason,
    last_completed_at: completed,
    checked_at: now.toISOString(),
    summary: reason
      ? (summaries[/** @type {keyof typeof summaries} */ (reason)] ??
        sourceHealthReasons[/** @type {keyof typeof sourceHealthReasons} */ (reason)])
      : automatic
        ? "La última ventana de importación está completa y dentro de 24 horas. Esto no acredita todas las ventas del negocio."
        : sources.length
          ? "Las conexiones monitoreadas declaran datos completos y vigentes. No demuestra ventas que no fueron registradas."
          : "El análisis usa únicamente las compras registradas en PF. Este método no tiene un plazo automático de sincronización.",
    action: { label: "Revisar conexión de caja", href: "#conectar-caja" },
  };
}
/**
 * @param {{ recovery_run_id?: unknown, audience_snapshot?: MerchantAudienceSnapshot | null }} [campaign]
 */
export function campaignNeedsFreshActivity(campaign = {}) {
  if (campaign.recovery_run_id) return true;
  const definition = campaign.audience_snapshot?.definition;
  return /** @type {Array<"include" | "exclude">} */ (["include", "exclude"]).some((group) => {
    const rules = definition?.[group]?.rules;
    return (
      Array.isArray(rules) &&
      rules.some((rule) =>
        /** @type {unknown[]} */ ([
          "last_purchase_days",
          "has_purchase",
          "purchase_count",
          "spend_q",
        ]).includes(rule.field),
      )
    );
  });
}
/**
 * @param {{
 *   business?: MerchantBusinessLike,
 *   campaign?: Parameters<typeof campaignNeedsFreshActivity>[0] | null,
 *   rule?: string | null,
 *   now?: Date,
 * }} options
 */
export function promotionDelay({ business = {}, campaign = null, rule = null, now = new Date() }) {
  const mode = business.program_json?.merchant_operating_mode,
    until = stamp(mode?.until);
  if (mode?.mode === "busy" && until && Date.parse(until) > now.getTime())
    return { reason: "business_busy", until };
  const quality = readinessForBusiness(business, now);
  if (
    !quality.inactivity_allowed &&
    (rule === "winback" || (campaign && campaignNeedsFreshActivity(campaign)))
  )
    return {
      reason: `data_quality_${quality.reason}`,
      until: new Date(now.getTime() + HOUR).toISOString(),
    };
  return null;
}
