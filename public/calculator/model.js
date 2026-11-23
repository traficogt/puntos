import { REGIONAL_COUNTRIES, REGIONAL_CURRENCY_CODES } from "../regional-catalog.js";

export const LIMITS = Object.freeze({
  money: 1_000_000_000,
  units: 1_000_000,
  rewards: 12,
  total: 1_000_000_000_000,
});
const currencies = new Set(REGIONAL_CURRENCY_CODES);
const missing = (value) => value === null || value === undefined;
export const currencyPrecision = (currency) => (currency === "CLP" ? 0 : 2);
export function formatMoney(value, currency) {
  if (value === null || !Number.isFinite(value)) return "Sin calcular";
  const locale =
    Object.values(REGIONAL_COUNTRIES).find((region) => region.currency === currency)?.locale ||
    "es-GT";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: currencyPrecision(currency),
    maximumFractionDigits: currencyPrecision(currency),
  }).format(value);
}

// A decimal comma is accepted. Grouping separators and exponent notation are
// deliberately rejected so "1,000" cannot silently become one thousand.
export function parseDecimal(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^-?\d+(?:[.,]\d+)?$/.test(text)) return NaN;
  return Number(text.replace(",", "."));
}

const labels = {
  subscription: "Suscripción PF",
  setup: "Implementación",
  messaging: "Mensajes",
  operations: "Operación adicional",
};

/** Pure, local scenario arithmetic. No observed sales, merchant data or defaults for a return. */
export function calculateLoyalty(input) {
  const errors = [];
  const moneyPlaces = currencyPrecision(input.currency);
  /** @param {unknown} value @param {string} field @param {{optional?: boolean, min?: number, max?: number, places?: number}} [options] */
  function read(
    value,
    field,
    { optional = false, min = 0, max = LIMITS.money, places = moneyPlaces } = {},
  ) {
    if (missing(value)) {
      if (!optional)
        errors.push({ field, message: "Escribe un valor; usa 0 solo si lo confirmaste." });
      return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      errors.push({
        field,
        message: `Escribe un número entre ${min} y ${max}, sin separadores de miles.`,
      });
      return null;
    }
    if (Math.round(value * 10 ** places) / 10 ** places !== value) {
      errors.push({
        field,
        message:
          places === 0
            ? "Escribe una cantidad entera, sin decimales."
            : `Usa como máximo ${places} decimales, sin separadores de miles.`,
      });
      return null;
    }
    return value;
  }
  if (!currencies.has(input.currency))
    errors.push({ field: "currency", message: "Selecciona una moneda de la lista." });
  const percent = read(input.redemptionPercent, "redemptionPercent", { max: 100, places: 2 });
  if (
    !Array.isArray(input.rewards) ||
    input.rewards.length < 1 ||
    input.rewards.length > LIMITS.rewards
  ) {
    return {
      errors: [
        ...errors,
        { field: "rewards", message: `Incluye entre 1 y ${LIMITS.rewards} premios.` },
      ],
    };
  }
  const rewards = input.rewards.map((reward, index) => {
    const field = (key) => `reward-${index}-${key}`;
    if (!["product", "service", "discount"].includes(reward.kind))
      errors.push({ field: field("kind"), message: "Elige producto, servicio o descuento." });
    const units = read(reward.units, field("units"), { max: LIMITS.units, places: 0 });
    const unitCost = read(reward.unitCost, field("unitCost"), { optional: true });
    const opportunityCost =
      reward.kind === "service"
        ? read(reward.opportunityCost, field("opportunityCost"), { optional: true })
        : 0;
    const retailPrice =
      reward.kind !== "discount"
        ? read(reward.retailPrice, field("retailPrice"), { optional: true })
        : null;
    // Both operands are bounded integers after validation. Basis points avoid
    // a floating product turning an exact whole redemption into an extra unit.
    const scenarioUnits = Math.ceil((units * Math.round(percent * 100)) / 10000);
    const totalCost = unitCost === null ? null : unitCost + (opportunityCost ?? 0);
    const cost = (count) => (count === 0 ? 0 : totalCost === null ? null : count * totalCost);
    return {
      name: String(reward.name || `Premio ${index + 1}`).slice(0, 80),
      kind: reward.kind,
      units,
      unitCost,
      retailPrice,
      opportunityCost,
      scenarioUnits,
      fullCost: cost(units),
      scenarioCost: cost(scenarioUnits),
    };
  });
  const charges = input.costs || {};
  const costs = {};
  for (const key of Object.keys(labels)) costs[key] = read(charges[key], key, { optional: true });
  const setupMonths = read(charges.setupMonths, "setupMonths", {
    optional: !(costs.setup > 0),
    min: 1,
    max: 120,
    places: 0,
  });
  const purchase = input.purchase || {};
  const average = read(purchase.average, "average", { optional: true });
  const additional = read(purchase.additional, "additional", {
    optional: true,
    max: LIMITS.units,
    places: 0,
  });
  let contributionPerPurchase = null;
  if (purchase.mode === "margin") {
    const margin = read(purchase.marginPercent, "marginPercent", {
      optional: true,
      min: -100,
      max: 100,
      places: 2,
    });
    if (average !== null && margin !== null) contributionPerPurchase = (average * margin) / 100;
  } else if (purchase.mode === "variable") {
    const variableCost = read(purchase.variableCost, "variableCost", { optional: true });
    if (average !== null && variableCost !== null) contributionPerPurchase = average - variableCost;
  } else errors.push({ field: "marginMode", message: "Elige margen o costo variable." });
  let allowance = null;
  if (purchase.allowanceMode === "amount")
    allowance = read(purchase.rewardAllowance, "rewardAllowance", { optional: true, places: 6 });
  else if (purchase.allowanceMode === "none") allowance = 0;
  else if (purchase.allowanceMode)
    errors.push({
      field: "allowanceMode",
      message: "Elige cómo reservar los premios de compras adicionales.",
    });
  if (errors.length) return { errors };

  const omittedCosts = Object.keys(labels)
    .filter((key) => costs[key] === null)
    .map((key) => labels[key]);
  const monthlyCosts =
    (costs.subscription ?? 0) +
    (costs.messaging ?? 0) +
    (costs.operations ?? 0) +
    (costs.setup > 0 ? costs.setup / setupMonths : 0);
  const unknownRewards = rewards.filter((reward) => reward.fullCost === null);
  const knownFullRewardCost = rewards.reduce((sum, reward) => sum + (reward.fullCost ?? 0), 0);
  const knownScenarioRewardCost = rewards.reduce(
    (sum, reward) => sum + (reward.scenarioCost ?? 0),
    0,
  );
  // Even a 0% scenario cannot turn an unknown promise into a fully costed plan.
  const fullRewardCost = unknownRewards.length ? null : knownFullRewardCost;
  const scenarioRewardCost = unknownRewards.length ? null : knownScenarioRewardCost;
  const fullBudget = fullRewardCost === null ? null : fullRewardCost + monthlyCosts;
  const scenarioBudget = scenarioRewardCost === null ? null : scenarioRewardCost + monthlyCosts;
  const availablePerPurchase =
    contributionPerPurchase === null || allowance === null
      ? null
      : contributionPerPurchase - allowance;
  let thresholdReason = unknownRewards.length
    ? "unknown_rewards"
    : contributionPerPurchase === null
      ? "unknown_purchase"
      : allowance === null
        ? "unknown_allowance"
        : availablePerPurchase <= 0
          ? "nonpositive_contribution"
          : null;
  const threshold = (budget) => {
    if (budget === null || availablePerPurchase === null) return null;
    if (budget === 0) return 0;
    if (availablePerPurchase <= 0) return null;
    const quotient = budget / availablePerPurchase;
    if (quotient > LIMITS.total) {
      thresholdReason = "threshold_limit";
      return null;
    }
    // Cancel multiplication noise only at an integer boundary, not a fraction
    // of a purchase. The threshold uses unrounded costs and contribution.
    return Math.ceil(quotient - Math.abs(quotient) * Number.EPSILON * 4);
  };
  const breakEven = threshold(scenarioBudget);
  const fullBreakEven = threshold(fullBudget);
  const additionalRevenue = additional === null || average === null ? null : additional * average;
  const incrementalRewardCost =
    additional === null || allowance === null ? null : additional * allowance;
  const grossContribution =
    additional === null || contributionPerPurchase === null
      ? null
      : additional * contributionPerPurchase;
  const net =
    additional === null || availablePerPurchase === null || scenarioBudget === null
      ? null
      : additional * availablePerPurchase - scenarioBudget;
  const netContribution =
    net !== null && Math.abs(net) < Number.EPSILON * Math.max(1, scenarioBudget) * 8 ? 0 : net;
  const totals = [
    knownFullRewardCost,
    knownScenarioRewardCost,
    monthlyCosts,
    fullBudget,
    scenarioBudget,
    additionalRevenue,
    grossContribution,
    incrementalRewardCost,
    netContribution,
  ];
  if (
    totals.some(
      (value) => value !== null && (!Number.isFinite(value) || Math.abs(value) > LIMITS.total),
    )
  ) {
    return {
      errors: [
        {
          field: "calculation",
          message:
            "El total supera el límite de un billón. Reduce las cantidades o los importes para este escenario mensual.",
        },
      ],
    };
  }
  return {
    errors,
    rewards,
    unknownRewards,
    omittedCosts,
    monthlyCosts,
    knownFullRewardCost,
    knownScenarioRewardCost,
    fullFulfillmentCost: unknownRewards.length
      ? null
      : rewards.reduce((sum, reward) => sum + reward.units * (reward.unitCost ?? 0), 0),
    fullOpportunityCost: rewards.reduce(
      (sum, reward) => sum + reward.units * (reward.opportunityCost ?? 0),
      0,
    ),
    fullRewardCost,
    scenarioRewardCost,
    fullBudget,
    scenarioBudget,
    contributionPerPurchase,
    availablePerPurchase,
    allowance,
    breakEven,
    fullBreakEven,
    thresholdReason,
    additionalRevenue,
    incrementalRewardCost,
    grossContribution,
    netContribution,
    omittedOpportunity: rewards
      .filter((reward) => reward.kind === "service" && reward.opportunityCost === null)
      .map((reward) => reward.name),
  };
}
