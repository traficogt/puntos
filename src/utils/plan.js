const PLAN_ORDER = ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"];

const PLAN_LIMITS = {
  EMPRENDEDOR: { activeCustomers: 100, rewards: 5, branches: 1 },
  NEGOCIO: { activeCustomers: 500, rewards: 9999, branches: 3 },
  EMPRESA: { activeCustomers: 999999, rewards: 9999, branches: 9999 }
};

const PLAN_PRICING_GTQ = {
  EMPRENDEDOR: { monthly: 149, yearly: 1490, notes: "Ideal para cafeterias pequenas y negocios en etapa inicial." },
  NEGOCIO: { monthly: 399, yearly: 3990, notes: "Para negocios con varias sedes, equipo y automatizaciones." },
  EMPRESA: { monthly: 999, yearly: 9990, notes: "Para cadenas y operaciones multi-sucursal con integraciones avanzadas." }
};

const PLAN_MESSAGING_GTQ = {
  EMPRENDEDOR: { included_messages: 250, overage_per_message_q: 0.20 },
  NEGOCIO: { included_messages: 1000, overage_per_message_q: 0.16 },
  EMPRESA: { included_messages: 3000, overage_per_message_q: 0.12 }
};

export const DEFAULT_PLAN_FEATURES = {
  EMPRENDEDOR: {
    gift_cards: false,
    rewards: true,
    redemptions: true,
    program_rules: true,
    staff_management: true,
    fraud_monitoring: true,
    lifecycle_automation: true,
    customer_export: false,
    rbac_matrix: false,
    analytics: false,
    tiers: false,
    referrals: false,
    gamification: false,
    multi_branch: false,
    webhooks: false,
    external_awards: false,
    campaign_rules: false
  },
  NEGOCIO: {
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
    gamification: false,
    multi_branch: true,
    webhooks: true,
    external_awards: false,
    campaign_rules: true
  },
  EMPRESA: {
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
    campaign_rules: true
  }
};

export function normalizePlan(plan) {
  return String(plan || "").trim().toUpperCase();
}

export function planLimits(plan) {
  const key = normalizePlan(plan);
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.EMPRESA;
}

export function planFeatures(plan) {
  const key = normalizePlan(plan);
  return DEFAULT_PLAN_FEATURES[key] ?? DEFAULT_PLAN_FEATURES.EMPRESA;
}

export function mergePlanFeatures(overrides = {}) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_PLAN_FEATURES));
  if (!overrides || typeof overrides !== "object") return merged;
  for (const [plan, featureMap] of Object.entries(overrides)) {
    const p = normalizePlan(plan);
    if (!merged[p] || !featureMap || typeof featureMap !== "object") continue;
    for (const [feature, enabled] of Object.entries(featureMap)) {
      if (Object.prototype.hasOwnProperty.call(merged[p], feature)) {
        merged[p][feature] = Boolean(enabled);
      }
    }
  }
  return merged;
}

export function planFeaturesWithOverrides(plan, overrides = {}) {
  const key = normalizePlan(plan);
  const merged = mergePlanFeatures(overrides);
  return merged[key] ?? merged.EMPRESA;
}

export function hasPlanFeature(plan, feature, overrides = {}) {
  return Boolean(planFeaturesWithOverrides(plan, overrides)[feature]);
}

export function suggestedPlanForFeature(feature) {
  for (const p of PLAN_ORDER) {
    if (DEFAULT_PLAN_FEATURES[p]?.[feature]) return p;
  }
  return "EMPRESA";
}

export function listPlans(overrides = {}) {
  const merged = mergePlanFeatures(overrides);
  return PLAN_ORDER.map((plan) => ({
    plan,
    limits: PLAN_LIMITS[plan],
    features: merged[plan],
    pricing_gtq: PLAN_PRICING_GTQ[plan],
    messaging_gtq: PLAN_MESSAGING_GTQ[plan]
  }));
}

export function isActiveCustomer(lastVisitAt, createdAt, now = new Date()) {
  const ref = lastVisitAt ?? createdAt;
  const ms = 90 * 24 * 60 * 60 * 1000;
  return now.getTime() - new Date(ref).getTime() <= ms;
}
