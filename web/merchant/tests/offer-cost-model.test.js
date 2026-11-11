import assert from 'node:assert/strict';
import { before, test } from 'node:test';

let preview, budgetFromAllowance, marginIllustration, preflightCostEstimate;
before(async () => {
  const model = await import('../src/offer-cost-model.js').catch(() => null);
  assert.equal(typeof model?.offerCostPreview, 'function', 'offer cost preview must be implemented');
  ({ offerCostPreview: preview, budgetFromAllowance, marginIllustration, preflightCostEstimate } = model);
});
const terms = { bonusPoints: 50, pointsBudget: 125, audienceCount: 20, holdoutPercent: 20, costPerPoint: 0.1 };

test('caps whole bonuses by budget and the audience after control allocation', () => {
  const result = preview(terms);
  assert.deepEqual([result.controlCount, result.treatmentCount, result.maximumBonuses, result.maximumPoints, result.maximumCost], [4, 16, 2, 100, 10]);
  assert.equal(preview({ ...terms, pointsBudget: 2000 }).maximumPoints, 800);
  assert.equal(preview({ ...terms, pointsBudget: null }).maximumPoints, 800);
  assert.equal(preview({ ...terms, pointsBudget: 2000, quiet: true }).maximumPoints, 1000);
});
test('keeps unknown audiences and unknown costs separate from confirmed zero', () => {
  assert.equal(preview({ ...terms, costPerPoint: null }).maximumCost, null);
  assert.equal(preview({ ...terms, costPerPoint: 0 }).maximumCost, 0);
  assert.equal(preview({ ...terms, audienceCount: null, pointsBudget: null }).maximumPoints, null);
  assert.equal(preview({ ...terms, audienceCount: null }).maximumPoints, 100);
  assert.equal(preview({ ...terms, audienceCount: 0 }).maximumPoints, 0);
});
test('redemption scenarios never reduce the maximum and round money conservatively for the currency', () => {
  const result = preview({ ...terms, redemptionPercent: 25 });
  assert.deepEqual([result.maximumPoints, result.maximumCost, result.scenarioPoints, result.scenarioCost], [100, 10, 25, 2.5]);
  assert.equal(preview({ ...terms, costPerPoint: 0.002, minorUnits: 0 }).maximumCost, 1);
  assert.equal(preview({ ...terms, costPerPoint: 0.000001 }).maximumCost, 0.01);
});
test('converts a currency allowance to an enforceable whole-bonus point limit without floating-point overspend', () => {
  assert.deepEqual(budgetFromAllowance({ allowance: 0.3, costPerPoint: 0.1, bonusPoints: 1 }), { pointsBudget: 3, bonuses: 3, estimatedCost: 0.3, reason: null });
  assert.deepEqual(budgetFromAllowance({ allowance: 10, costPerPoint: 0.1, bonusPoints: 30 }), { pointsBudget: 90, bonuses: 3, estimatedCost: 9, reason: null });
  assert.equal(budgetFromAllowance({ allowance: 1, costPerPoint: 0.000001, bonusPoints: 7, minorUnits: 0 }).pointsBudget, 999999);
  assert.equal(budgetFromAllowance({ allowance: 1000000, costPerPoint: 0.000001, bonusPoints: 3 }).pointsBudget, 1999998);
});
test('does not invent a limit from missing, zero or insufficient cost assumptions', () => {
  for (const [costPerPoint, reason] of [[null, 'unknown_cost'], [0, 'zero_cost'], [0.1, 'below_one_bonus']]) {
    assert.equal(budgetFromAllowance({ allowance: 1, costPerPoint, bonusPoints: 50 }).reason, reason);
  }
  assert.equal(budgetFromAllowance({ allowance: 1.5, costPerPoint: 0.1, bonusPoints: 50, minorUnits: 0 }).reason, 'invalid');
  assert.equal(budgetFromAllowance({ allowance: 1, costPerPoint: 1e-13, bonusPoints: 50 }).reason, 'invalid');
});
test('rejects invalid term inputs instead of coercing blanks and invalid numbers to zero', () => {
  for (const change of [{ bonusPoints: 0 }, { pointsBudget: 49 }, { pointsBudget: '' }, { audienceCount: -1 }, { costPerPoint: '' }, { costPerPoint: 101 }, { costPerPoint: 0.0000001 }, { redemptionPercent: -1 }, { redemptionPercent: 101 }, { minorUnits: 7 }]) {
    assert.equal(preview({ ...terms, ...change }), null, JSON.stringify(change));
  }
});
test('illustrates one entered sale and gross margin, never basket profit inferred from points', () => {
  const input = { saleAmount: 40, grossMarginPct: 30, bonusPoints: 50, costPerPoint: 0.1 };
  assert.deepEqual(marginIllustration(input), { grossMargin: 12, bonusCost: 5, afterBonus: 7 });
  assert.equal(marginIllustration({ ...input, grossMarginPct: 0 }).afterBonus, -5);
  assert.equal(marginIllustration({ ...input, saleAmount: 0 }).afterBonus, -5);
  assert.equal(marginIllustration({ ...input, costPerPoint: 0 }).afterBonus, 12);
  assert.equal(marginIllustration({ ...input, costPerPoint: null }).afterBonus, null);
  for (const change of [{ saleAmount: null }, { grossMarginPct: null }, { saleAmount: '' }, { grossMarginPct: 101 }]) assert.equal(marginIllustration({ ...input, ...change }), null);
});

test('final approval keeps positive subcent and CLP costs above zero with conservative rounding', () => {
  assert.equal(typeof preflightCostEstimate, 'function');
  const make = (points, rate) => ({ maximum_commitment_points: points, maximum_incentive_cost_q: points * rate, cost_assumptions: { per_point_q: rate } });
  assert.equal(preflightCostEstimate(make(800, 0.000001), 2), 0.01);
  assert.equal(preflightCostEstimate(make(100, 0.002), 0), 1);
  assert.equal(preflightCostEstimate(make(3, 0.1), 2), 0.3);
  assert.equal(preflightCostEstimate(make(800, 0), 2), 0);
  assert.equal(preflightCostEstimate({ maximum_incentive_cost_q: null }, 2), null);
  assert.equal(preflightCostEstimate({ maximum_incentive_cost_q: 0.0008 }, 2), 0.01);
});
