import { regionTimezone } from './regional-settings.js';
import { evaluatePointRules } from './transaction-rule-evidence.js';

export function computePointsWithEvidence(business, input, { now = new Date(), timeZone = regionTimezone(business) } = {}) {
  return evaluatePointRules(business, input, { now, timeZone });
}

export function computePoints(business, input) {
  return computePointsWithEvidence(business, input).points;
}
