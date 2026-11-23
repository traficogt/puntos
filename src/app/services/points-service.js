import { regionTimezone } from "./regional-settings.js";
import { evaluatePointRules } from "./transaction-rule-evidence.js";

// Live award/order/POS/API computations: a points program must have an explicit rule (see evaluator).
export function computePointsWithEvidence(
  business,
  input,
  { now = new Date(), timeZone = regionTimezone(business), requireRule = true } = {},
) {
  return evaluatePointRules(business, input, { now, timeZone, requireRule });
}

export function computePoints(business, input) {
  return computePointsWithEvidence(business, input).points;
}
