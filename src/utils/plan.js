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

/** @type {Record<PlanName, { monthly: number, yearly: number, notes: string }>} */
const PLAN_PRICING_GTQ = {
  EMPRENDEDOR: {
    monthly: 149,
    yearly: 1490,
    notes: "Ideal para cafeterias pequenas y negocios en etapa inicial.",
  },
  NEGOCIO: {
    monthly: 399,
    yearly: 3990,
    notes: "Para negocios con varias sedes, equipo y automatizaciones.",
  },
  EMPRESA: {
    monthly: 999,
    yearly: 9990,
    notes: "Para cadenas y operaciones multi-sucursal con integraciones avanzadas.",
  },
};

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
 * Every plan with its limits, features (overrides applied) and GTQ pricing,
 * cheapest first. `plan` is widened to `string` because callers compare it with
 * user-supplied plan names.
 * @param {unknown} [overrides] see mergePlanFeatures
 */
export function listPlans(overrides = {}) {
  const merged = mergePlanFeatures(overrides);
  return PLAN_ORDER.map((plan) => ({
    plan: /** @type {string} */ (plan),
    limits: PLAN_LIMITS[plan],
    features: merged[plan],
    pricing_gtq: PLAN_PRICING_GTQ[plan],
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
