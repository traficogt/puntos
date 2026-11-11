const pointScale = 1000000n;
const maximumBudget = 2000000;
const validBonus = value => Number.isInteger(value) && value >= 1 && value <= 10000;
const validPrecision = value => Number.isInteger(value) && value >= 0 && value <= 3;
const decimal = (value, max, places) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && Math.round(value * 10 ** places) / 10 ** places === value;
const validCost = value => value === null || decimal(value, 100, 6);
const costUnits = value => BigInt(Math.round(value * Number(pointScale)));

// Round displayed exposure upwards to the currency's minor unit. Calculation
// uses the entered six-decimal assumption, not a rounded per-bonus amount.
function costForPoints(points, costPerPoint, minorUnits) {
  if (points === null || costPerPoint === null) return null;
  const scale = 10n ** BigInt(minorUnits);
  const total = BigInt(points) * costUnits(costPerPoint) * scale;
  return Number((total + pointScale - 1n) / pointScale) / Number(scale);
}

/** Use the reviewed server commitment and assumption, with the same upward rounding as the draft. */
export function preflightCostEstimate(preflight, minorUnits = 2) {
  if (!validPrecision(minorUnits) || preflight?.maximum_incentive_cost_q == null) return null;
  if (Object.hasOwn(preflight.cost_assumptions ?? {}, 'per_point_q')) {
    const rate = preflight.cost_assumptions.per_point_q, points = preflight.maximum_commitment_points;
    if (!validCost(rate) || !Number.isSafeInteger(points) || points < 0) return null;
    return costForPoints(points, rate, minorUnits);
  }
  // Older preflight responses only exposed the total. Ignore multiplication
  // noise at a currency boundary, while retaining every positive minor unit.
  const amount = preflight.maximum_incentive_cost_q, scale = 10 ** minorUnits;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  return Math.ceil((amount - amount * Number.EPSILON) * scale) / scale;
}

export function offerCostPreview({ bonusPoints, pointsBudget = null, audienceCount = null, holdoutPercent = 20, quiet = false, costPerPoint = null, redemptionPercent = 100, minorUnits = 2 }) {
  if (!validBonus(bonusPoints) || !validCost(costPerPoint) || !validPrecision(minorUnits)
    || pointsBudget !== null && (!Number.isInteger(pointsBudget) || pointsBudget < bonusPoints || pointsBudget > maximumBudget)
    || audienceCount !== null && (!Number.isSafeInteger(audienceCount) || audienceCount < 0 || audienceCount > 5000)
    || !Number.isFinite(holdoutPercent) || holdoutPercent < 0 || holdoutPercent > 100
    || !Number.isFinite(redemptionPercent) || redemptionPercent < 0 || redemptionPercent > 100) return null;
  const controlCount = audienceCount === null ? null : quiet ? 0 : Math.min(audienceCount, Math.max(1, Math.round(audienceCount * holdoutPercent / 100)));
  const treatmentCount = audienceCount === null ? null : audienceCount - controlCount;
  const capacity = Math.min(treatmentCount ?? Infinity, pointsBudget === null ? Infinity : Math.floor(pointsBudget / bonusPoints));
  const maximumBonuses = Number.isFinite(capacity) ? capacity : null;
  const maximumPoints = maximumBonuses === null ? null : maximumBonuses * bonusPoints;
  const scenarioPoints = maximumPoints === null ? null : Math.floor(maximumPoints * redemptionPercent / 100);
  return { controlCount, treatmentCount, maximumBonuses, maximumPoints,
    maximumCost: costForPoints(maximumPoints, costPerPoint, minorUnits), scenarioPoints,
    scenarioCost: costForPoints(scenarioPoints, costPerPoint, minorUnits) };
}

export function budgetFromAllowance({ allowance, costPerPoint, bonusPoints, minorUnits = 2 }) {
  const unavailable = reason => ({ pointsBudget: null, bonuses: null, estimatedCost: null, reason });
  if (!validBonus(bonusPoints) || !validCost(costPerPoint) || !validPrecision(minorUnits) || !decimal(allowance, 1000000000, minorUnits)) return unavailable('invalid');
  if (costPerPoint === null) return unavailable('unknown_cost');
  if (costPerPoint === 0) return unavailable('zero_cost');
  const scale = 10n ** BigInt(minorUnits);
  const units = BigInt(Math.round(allowance * Number(scale)));
  const affordable = units * pointScale / (scale * BigInt(bonusPoints) * costUnits(costPerPoint));
  const bonuses = Number(affordable < BigInt(Math.floor(maximumBudget / bonusPoints)) ? affordable : BigInt(Math.floor(maximumBudget / bonusPoints)));
  if (bonuses < 1) return unavailable('below_one_bonus');
  const pointsBudget = bonuses * bonusPoints;
  return { pointsBudget, bonuses, estimatedCost: costForPoints(pointsBudget, costPerPoint, minorUnits), reason: null };
}

export function marginIllustration({ saleAmount, grossMarginPct, bonusPoints, costPerPoint, minorUnits = 2 }) {
  if (!validPrecision(minorUnits) || !decimal(saleAmount, 1000000000, minorUnits) || !decimal(grossMarginPct, 100, 2) || !validBonus(bonusPoints) || !validCost(costPerPoint)) return null;
  const scale = 10 ** minorUnits;
  const grossMargin = Math.round((saleAmount * grossMarginPct / 100 + Number.EPSILON) * scale) / scale;
  const bonusCost = costForPoints(bonusPoints, costPerPoint, minorUnits);
  return { grossMargin, bonusCost, afterBonus: bonusCost === null ? null : Math.round((grossMargin - bonusCost) * scale) / scale };
}
