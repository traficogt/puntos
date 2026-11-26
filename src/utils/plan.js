/** @typedef {"EMPRENDEDOR" | "NEGOCIO" | "EMPRESA"} PlanName */

/** @type {readonly PlanName[]} ascending by price */
const PLAN_ORDER = ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"];

/** @typedef {{ activeCustomers: number, rewards: number, branches: number }} PlanLimits */

/** @type {Record<PlanName, PlanLimits>} */
const PLAN_LIMITS = {
  EMPRENDEDOR: { activeCustomers: 300, rewards: 5, branches: 1 },
  NEGOCIO: { activeCustomers: 2000, rewards: 9999, branches: 3 },
  EMPRESA: { activeCustomers: 999999, rewards: 9999, branches: 9999 },
};

/**
 * Published list prices: USD per branch per month (owner decision, 2026-11-25; design of
 * record docs/product/2026-11-25-self-serve-trial.md). Charged to businesses outside
 * Guatemala. The platform setting `billing_catalog` may override the amounts; see
 * resolveBillingCatalog.
 * @type {Readonly<Record<PlanName, number>>}
 */
export const PLAN_PRICING_USD = Object.freeze({ EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 });
/**
 * Published list prices: quetzales per branch per month, charged to Guatemalan businesses
 * through Recurrente (owner decision, 2026-11-26: USD × 8 rounded to a round number, not
 * spot FX). Fixed list amounts, never converted at charge time. The platform setting
 * `billing_catalog.gtq` may override them from the super console.
 * @type {Readonly<Record<PlanName, number>>}
 */
export const PLAN_PRICING_GTQ = Object.freeze({ EMPRENDEDOR: 300, NEGOCIO: 630, EMPRESA: 1030 });
/** Billing unit of every published price. */
export const PRICING_UNIT = "branch_month";
/**
 * Every published amount, USD and GTQ, already includes Guatemala's IVA (owner decision,
 * 2026-11-26). The number on /precios is the number on the card statement; Recurrente's
 * No FEL invoice is issued for now (owner decision 2026-11-26); IVA-inclusive is a pricing statement.
 */
export const IVA_RATE = 0.12;

/**
 * The `platform_settings.billing_catalog` document after defaults are applied.
 * `iva_included` is always true (owner decision above); it travels with the catalog so
 * every surface reads the same statement instead of hardcoding it.
 * @typedef {{
 *   published_at: string,
 *   usd: Record<PlanName, number>,
 *   gtq: Record<PlanName, number>,
 *   iva_included: true,
 *   gtq_reference: { rate: number, as_of: string } | null,
 *   providers: {
 *     recurrente: { price_ids: { GTQ: Record<string, string>, USD: Record<string, string> } },
 *     stripe: { price_ids: { USD: Record<string, string> } }
 *   }
 * }} BillingCatalog
 */

/** @type {Readonly<BillingCatalog>} */
export const DEFAULT_BILLING_CATALOG = Object.freeze({
  published_at: "2026-11-26",
  usd: { ...PLAN_PRICING_USD },
  gtq: { ...PLAN_PRICING_GTQ },
  iva_included: true,
  gtq_reference: null,
  providers: {
    recurrente: { price_ids: { GTQ: {}, USD: {} } },
    stripe: { price_ids: { USD: {} } },
  },
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Per-plan positive integer amounts; a plan missing or invalid falls back to `fallback`
 * (or the whole map to null when `fallback` is null and nothing valid was supplied).
 * @param {unknown} raw
 * @param {Record<PlanName, number> | null} fallback
 * @returns {Record<PlanName, number> | null}
 */
function planAmounts(raw, fallback) {
  if (!isRecord(raw)) return fallback ? { ...fallback } : null;
  /** @type {Partial<Record<PlanName, number>>} */
  const out = {};
  for (const plan of PLAN_ORDER) {
    const n = Number(raw[plan]);
    if (Number.isInteger(n) && n > 0 && n <= 1_000_000) out[plan] = n;
    else if (fallback) out[plan] = fallback[plan];
  }
  if (Object.keys(out).length !== PLAN_ORDER.length) return fallback ? { ...fallback } : null;
  return /** @type {Record<PlanName, number>} */ (out);
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function priceIdMap(raw) {
  if (!isRecord(raw)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [plan, id] of Object.entries(raw)) {
    const p = normalizePlan(plan);
    if (isPlanName(p) && typeof id === "string" && id.trim()) out[p] = id.trim();
  }
  return out;
}

/**
 * Applies defaults to a stored `billing_catalog` document. Unknown keys are dropped,
 * invalid or missing amounts (USD and GTQ alike) fall back to the code list prices, IVA
 * is always marked as included, and the GTQ reference is kept only when both a positive
 * rate and a dated `as_of` are present (never spot FX).
 * @param {unknown} [raw] the platform setting as stored (or a super-console submission)
 * @returns {BillingCatalog}
 */
export function resolveBillingCatalog(raw = {}) {
  const input = isRecord(raw) ? raw : {};
  const reference = isRecord(input.gtq_reference) ? input.gtq_reference : null;
  const rate = reference ? Number(reference.rate) : NaN;
  const asOf = reference && typeof reference.as_of === "string" ? reference.as_of.trim() : "";
  const providers = isRecord(input.providers) ? input.providers : {};
  const recurrente = isRecord(providers.recurrente) ? providers.recurrente : {};
  const stripe = isRecord(providers.stripe) ? providers.stripe : {};
  const recurrentePrices = isRecord(recurrente.price_ids) ? recurrente.price_ids : {};
  const stripePrices = isRecord(stripe.price_ids) ? stripe.price_ids : {};
  return {
    published_at:
      typeof input.published_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(input.published_at)
        ? input.published_at
        : DEFAULT_BILLING_CATALOG.published_at,
    usd: /** @type {Record<PlanName, number>} */ (planAmounts(input.usd, PLAN_PRICING_USD)),
    gtq: /** @type {Record<PlanName, number>} */ (planAmounts(input.gtq, PLAN_PRICING_GTQ)),
    iva_included: true,
    gtq_reference:
      Number.isFinite(rate) && rate > 0 && /^\d{4}-\d{2}-\d{2}$/.test(asOf)
        ? { rate: Math.round(rate * 10000) / 10000, as_of: asOf }
        : null,
    providers: {
      recurrente: {
        price_ids: { GTQ: priceIdMap(recurrentePrices.GTQ), USD: priceIdMap(recurrentePrices.USD) },
      },
      stripe: { price_ids: { USD: priceIdMap(stripePrices.USD) } },
    },
  };
}

/** @type {Record<PlanName, { included_messages: number, overage_per_message_q: number }>} */
const PLAN_MESSAGING_GTQ = {
  EMPRENDEDOR: { included_messages: 250, overage_per_message_q: 0.2 },
  NEGOCIO: { included_messages: 1000, overage_per_message_q: 0.16 },
  EMPRESA: { included_messages: 3000, overage_per_message_q: 0.12 },
};

export const DEFAULT_PLAN_FEATURES = {
  EMPRENDEDOR: {
    basic_reporting: true,
    gift_cards: false,
    rewards: true,
    redemptions: true,
    program_rules: true,
    staff_management: true,
    fraud_monitoring: true,
    lifecycle_automation: false,
    customer_export: true,
    rbac_matrix: false,
    analytics: false,
    tiers: false,
    referrals: false,
    gamification: false,
    multi_branch: false,
    webhooks: false,
    external_awards: false,
    branded_qr: false,
    campaign_rules: false,
  },
  NEGOCIO: {
    basic_reporting: true,
    gift_cards: true,
    rewards: true,
    redemptions: true,
    program_rules: true,
    staff_management: true,
    fraud_monitoring: true,
    lifecycle_automation: true,
    customer_export: true,
    rbac_matrix: false,
    analytics: true,
    tiers: true,
    referrals: true,
    gamification: false,
    multi_branch: true,
    webhooks: false,
    external_awards: false,
    branded_qr: true,
    campaign_rules: true,
  },
  EMPRESA: {
    basic_reporting: true,
    gift_cards: true,
    rewards: true,
    redemptions: true,
    program_rules: true,
    staff_management: true,
    fraud_monitoring: true,
    lifecycle_automation: true,
    customer_export: true,
    rbac_matrix: true,
    analytics: true,
    tiers: true,
    referrals: true,
    gamification: true,
    multi_branch: true,
    webhooks: true,
    external_awards: true,
    branded_qr: true,
    campaign_rules: true,
  },
};

/** @typedef {typeof DEFAULT_PLAN_FEATURES} PlanFeatureTable plan -> feature -> enabled */

/**
 * Whether a normalized plan string names one of the plans (see normalizePlan).
 * @param {string} value an already-normalized plan string
 * @returns {value is PlanName}
 */
export function isPlanName(value) {
  return /** @type {readonly string[]} */ (PLAN_ORDER).includes(value);
}

/** @param {unknown} plan a stored plan value; trimmed and upper-cased */
export function normalizePlan(plan) {
  return String(plan || "")
    .trim()
    .toUpperCase();
}

/** @param {unknown} plan unknown plans fall back to EMPRENDEDOR */
export function planLimits(plan) {
  const key = normalizePlan(plan);
  return isPlanName(key) ? PLAN_LIMITS[key] : PLAN_LIMITS.EMPRENDEDOR;
}

/** @param {unknown} plan unknown plans fall back to EMPRENDEDOR */
export function planFeatures(plan) {
  const key = normalizePlan(plan);
  return isPlanName(key) ? DEFAULT_PLAN_FEATURES[key] : DEFAULT_PLAN_FEATURES.EMPRENDEDOR;
}

/**
 * Deep copy of the default feature table with per-plan boolean overrides
 * applied. Unknown plans and unknown features are ignored.
 * @param {unknown} [overrides] `{ [plan]: { [feature]: boolean } }`, typically from plan config
 * @returns {PlanFeatureTable}
 */
export function mergePlanFeatures(overrides = {}) {
  /** @type {PlanFeatureTable} */
  const merged = JSON.parse(JSON.stringify(DEFAULT_PLAN_FEATURES));
  if (!overrides || typeof overrides !== "object") return merged;
  for (const [plan, featureMap] of Object.entries(overrides)) {
    const p = normalizePlan(plan);
    if (!isPlanName(p) || !featureMap || typeof featureMap !== "object") continue;
    /** @type {Record<string, boolean>} */
    const target = merged[p];
    for (const [feature, enabled] of Object.entries(featureMap)) {
      if (Object.prototype.hasOwnProperty.call(target, feature)) {
        target[feature] = Boolean(enabled);
      }
    }
  }
  return merged;
}

/**
 * @param {unknown} plan
 * @param {unknown} [overrides] see mergePlanFeatures
 */
export function planFeaturesWithOverrides(plan, overrides = {}) {
  const key = normalizePlan(plan);
  const merged = mergePlanFeatures(overrides);
  return isPlanName(key) ? merged[key] : merged.EMPRENDEDOR;
}

/**
 * @param {unknown} plan
 * @param {string} feature a key of the feature table; unknown features are disabled
 * @param {unknown} [overrides] see mergePlanFeatures
 */
export function hasPlanFeature(plan, feature, overrides = {}) {
  /** @type {Record<string, boolean>} */
  const features = planFeaturesWithOverrides(plan, overrides);
  return Boolean(features[feature]);
}

// Program models that require a specific plan feature to be selected or operated.
// Earning models (SPEND, VISIT, ITEM, DISCOUNT, STAMP, CASHBACK) are part of core
// loyalty and available on every tier; the gift-card product is premium stored
// value. To make another model premium, add it here (e.g. CASHBACK: "cashback").
/** @type {Record<string, string>} program type -> plan feature it requires */
export const PROGRAM_TYPE_FEATURE = { GIFT_CARD: "gift_cards" };

/** @param {unknown} programType */
export function programTypeFeature(programType) {
  return (
    PROGRAM_TYPE_FEATURE[
      String(programType || "")
        .trim()
        .toUpperCase()
    ] ?? null
  );
}

/**
 * @param {unknown} plan
 * @param {unknown} programType
 * @param {unknown} [overrides] see mergePlanFeatures
 */
export function canUseProgramType(plan, programType, overrides = {}) {
  const feature = programTypeFeature(programType);
  return feature ? hasPlanFeature(plan, feature, overrides) : true;
}

/** @param {string} feature the cheapest plan that enables it by default; EMPRESA when none does */
export function suggestedPlanForFeature(feature) {
  for (const p of PLAN_ORDER) {
    /** @type {Record<string, boolean>} */
    const features = DEFAULT_PLAN_FEATURES[p];
    if (features?.[feature]) return p;
  }
  return "EMPRESA";
}

/**
 * Every plan with its limits, features (overrides applied) and pricing, cheapest
 * first. Both price blocks come from the catalog (code list prices unless the platform
 * setting overrides them): `pricing_usd` for businesses outside Guatemala, `pricing_gtq`
 * for Guatemalan businesses; `pricing_usd.gtq_monthly` repeats the quetzal amount for
 * callers that read one block. Amounts include IVA (`iva_included`).
 * `plan` is widened to `string` because callers compare it with user-supplied names.
 * @param {unknown} [overrides] see mergePlanFeatures
 * @param {BillingCatalog} [catalog] see resolveBillingCatalog
 */
export function listPlans(overrides = {}, catalog = DEFAULT_BILLING_CATALOG) {
  const merged = mergePlanFeatures(overrides);
  return PLAN_ORDER.map((plan) => ({
    plan: /** @type {string} */ (plan),
    limits: PLAN_LIMITS[plan],
    features: merged[plan],
    pricing_usd: {
      currency: "USD",
      per: PRICING_UNIT,
      monthly: catalog.usd[plan],
      gtq_monthly: catalog.gtq[plan],
    },
    pricing_gtq: { currency: "GTQ", per: PRICING_UNIT, monthly: catalog.gtq[plan] },
    iva_included: catalog.iva_included,
    messaging_gtq: PLAN_MESSAGING_GTQ[plan],
  }));
}

/**
 * Whether a customer counts as active: last visit (or sign-up) within 90 days.
 * @param {string | number | Date | null | undefined} lastVisitAt
 * @param {string | number | Date | null | undefined} createdAt
 * @param {Date} [now]
 */
export function isActiveCustomer(lastVisitAt, createdAt, now = new Date()) {
  const ref = lastVisitAt ?? createdAt;
  // No reference instant (null yields the epoch, undefined an invalid date):
  // neither is within the window, so the answer is false either way.
  if (ref === null || ref === undefined) return false;
  const ms = 90 * 24 * 60 * 60 * 1000;
  return now.getTime() - new Date(ref).getTime() <= ms;
}
