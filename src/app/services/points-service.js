import { regionTimezone } from "./regional-settings.js";
import { evaluatePointRules } from "./transaction-rule-evidence.js";

/**
 * @typedef {import("./transaction-rule-evidence.js").TransactionRuleEvidenceBusiness} PointsServiceBusiness
 * @typedef {import("./transaction-rule-evidence.js").TransactionRuleEvidenceInput} PointsServiceInput
 */

// Live award/order/POS/API computations: a points program must have an explicit rule (see evaluator).
/**
 * @param {PointsServiceBusiness} business
 * @param {PointsServiceInput} input
 * @param {{ now?: Date, timeZone?: string, requireRule?: boolean }} [options]
 */
export function computePointsWithEvidence(
  business,
  input,
  { now = new Date(), timeZone = regionTimezone(business), requireRule = true } = {},
) {
  return evaluatePointRules(business, input, { now, timeZone, requireRule });
}

/**
 * @param {PointsServiceBusiness} business
 * @param {PointsServiceInput} input
 */
export function computePoints(business, input) {
  return computePointsWithEvidence(business, input).points;
}
