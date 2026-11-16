import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLoyalty, parseDecimal, formatMoney, currencyPrecision } from '../../public/calculator/model.js';
import { REGIONAL_CURRENCY_CODES } from '../../public/regional-catalog.js';

const base = (overrides = {}) => ({
  currency: 'GTQ',
  rewards: [{ name: 'Café', kind: 'product', units: 80, unitCost: 9, retailPrice: 30 }],
  redemptionPercent: 50,
  costs: { subscription: 100, setup: 600, setupMonths: 6, messaging: 20, operations: 30 },
  purchase: { average: 50, mode: 'margin', marginPercent: 40, variableCost: null, additional: 100, allowanceMode: 'amount', rewardAllowance: 2 },
  ...overrides,
});

test('budgets all promised units separately from the selected scenario and additional sales', () => {
  const result = calculateLoyalty(base());
  assert.deepEqual(result.errors, []);
  assert.equal(result.fullRewardCost, 720);
  assert.equal(result.scenarioRewardCost, 360);
  assert.equal(result.monthlyCosts, 250);
  assert.equal(result.fullBudget, 970);
  assert.equal(result.scenarioBudget, 610);
  assert.equal(result.contributionPerPurchase, 20);
  assert.equal(result.availablePerPurchase, 18);
  assert.equal(result.breakEven, 34);
  assert.equal(result.fullBreakEven, 54);
  assert.equal(result.additionalRevenue, 5000);
  assert.equal(result.incrementalRewardCost, 200);
  assert.equal(result.netContribution, 1190);
});

test('missing cost blocks a total, while a confirmed zero is a real zero', () => {
  const unknown = calculateLoyalty(base({ rewards: [{ kind: 'product', units: 10, unitCost: null }] }));
  assert.equal(unknown.fullBudget, null);
  assert.equal(unknown.breakEven, null);
  assert.equal(unknown.netContribution, null);
  assert.equal(unknown.unknownRewards.length, 1);
  const zero = calculateLoyalty(base({ rewards: [{ kind: 'product', units: 10, unitCost: 0 }] }));
  assert.equal(zero.fullRewardCost, 0);
  assert.equal(zero.breakEven, 14);
});

test('service capacity cost is separate from fulfillment and retail price is never treated as expense', () => {
  const result = calculateLoyalty(base({ rewards: [
    { kind: 'product', units: 2, unitCost: 8, retailPrice: 999 },
    { kind: 'service', units: 3, unitCost: 10, opportunityCost: 20, retailPrice: 150 },
    { kind: 'discount', units: 5, unitCost: 7, retailPrice: 900 },
  ] }));
  assert.equal(result.fullRewardCost, 141);
  assert.equal(result.fullFulfillmentCost, 81);
  assert.equal(result.fullOpportunityCost, 60);
  assert.equal(result.scenarioRewardCost, 89); // 1 product, 2 services, 3 discounts (whole units)
});

test('variable costs are subtracted once and discount face value is counted once', () => {
  const input = base({ rewards: [{ kind: 'discount', units: 10, unitCost: 5 }] });
  input.purchase = { ...input.purchase, mode: 'variable', variableCost: 30, marginPercent: 90 };
  const result = calculateLoyalty(input);
  assert.equal(result.contributionPerPurchase, 20);
  assert.equal(result.fullRewardCost, 50);
  assert.equal(result.scenarioRewardCost, 25);
  assert.equal(result.netContribution, 1525);
});

test('unknown extra-purchase allowance never produces an optimistic break-even', () => {
  const input = base();
  input.purchase.allowanceMode = '';
  const result = calculateLoyalty(input);
  assert.equal(result.breakEven, null);
  assert.equal(result.netContribution, null);
  assert.equal(result.thresholdReason, 'unknown_allowance');
  input.purchase.allowanceMode = 'none';
  assert.equal(calculateLoyalty(input).breakEven, 31);
});

test('unfavorable contribution and a reward allowance that exhausts margin have no positive threshold', () => {
  for (const rewardAllowance of [20, 21]) {
    const input = base();
    input.purchase.rewardAllowance = rewardAllowance;
    const result = calculateLoyalty(input);
    assert.equal(result.breakEven, null);
    assert.equal(result.thresholdReason, 'nonpositive_contribution');
    assert.ok(result.netContribution < 0);
  }
  const input = base();
  input.purchase.marginPercent = -10;
  assert.equal(calculateLoyalty(input).netContribution, -1310);
});

test('additional purchases are optional and explicit zero stays zero', () => {
  const input = base();
  input.purchase.additional = null;
  assert.equal(calculateLoyalty(input).netContribution, null);
  input.purchase.additional = 0;
  assert.equal(calculateLoyalty(input).netContribution, -610);
});

test('zero redemption does not erase the full commitment or future reward allowance', () => {
  const result = calculateLoyalty(base({ redemptionPercent: 0 }));
  assert.equal(result.scenarioRewardCost, 0);
  assert.equal(result.fullRewardCost, 720);
  assert.equal(result.availablePerPurchase, 18);
  assert.equal(result.breakEven, 14);
});

test('omitted optional charges are disclosed and setup must have a monthly allocation', () => {
  const result = calculateLoyalty(base({ costs: {} }));
  assert.equal(result.monthlyCosts, 0);
  assert.equal(result.omittedCosts.length, 4);
  const invalid = calculateLoyalty(base({ costs: { setup: 600, setupMonths: null } }));
  assert.ok(invalid.errors.some(error => error.field === 'setupMonths'));
});

test('validated ranges reject infinity, strings, fractional units and invalid currencies', () => {
  for (const units of [Infinity, NaN, '10', -1, 1.5, 1_000_001]) {
    assert.ok(calculateLoyalty(base({ rewards: [{ kind: 'product', units, unitCost: 1 }] })).errors.length);
  }
  for (const cost of [-1, Infinity, 1_000_000_001]) {
    assert.ok(calculateLoyalty(base({ rewards: [{ kind: 'product', units: 1, unitCost: cost }] })).errors.length);
  }
  assert.ok(calculateLoyalty(base({ currency: 'ABC' })).errors.length);
  assert.ok(calculateLoyalty(base({ redemptionPercent: 101 })).errors.length);
  assert.ok(calculateLoyalty(base({ rewards: [] })).errors.length);
});

test('decimal parsing accepts a decimal comma but rejects grouped, exponent and ambiguous input', () => {
  assert.equal(parseDecimal('12,50'), 12.5);
  assert.equal(parseDecimal('12.50'), 12.5);
  assert.equal(parseDecimal(' 0 '), 0);
  assert.equal(parseDecimal(''), null);
  for (const text of ['1,000.5', '1.000,5', '1e5', 'Infinity', '1 000', '--2', '1,2,3']) assert.ok(Number.isNaN(parseDecimal(text)));
});

test('all regional currencies format with codes; CLP has no fraction and its minor unit is enforced', () => {
  for (const currency of REGIONAL_CURRENCY_CODES) assert.ok(formatMoney(1234, currency).includes(currency));
  assert.equal(currencyPrecision('CLP'), 0);
  assert.equal(currencyPrecision('GTQ'), 2);
  assert.ok(calculateLoyalty(base({ currency: 'CLP', rewards: [{ kind: 'product', units: 1, unitCost: 1.5 }] })).errors.length);
  assert.match(formatMoney(1234, 'CLP'), /1[.,]234/);
});

test('floating point arithmetic does not add a spurious break-even purchase at an exact boundary', () => {
  const input = base({ rewards: [{ kind: 'product', units: 3, unitCost: 0.1 }], redemptionPercent: 100, costs: {} });
  input.purchase = { ...input.purchase, average: 0.1, mode: 'margin', marginPercent: 100, allowanceMode: 'none', additional: 3 };
  const result = calculateLoyalty(input);
  assert.equal(result.breakEven, 3);
  assert.equal(result.netContribution, 0);
});

test('sub-minor-unit entry cannot evade currency precision checks, even with a very small value', () => {
  for (const unitCost of [0.000000001, 1.001, 1.000000001]) {
    const result = calculateLoyalty(base({ rewards: [{ kind: 'product', units: 1, unitCost }] }));
    assert.ok(result.errors.some(error => error.field === 'reward-0-unitCost'));
  }
});

test('confirmed zero units need no reward cost and zero budget requires zero additional purchases', () => {
  const input = base({ rewards: [{ kind: 'product', units: 0, unitCost: null }], costs: {} });
  assert.equal(calculateLoyalty(input).fullBudget, 0);
  assert.equal(calculateLoyalty(input).breakEven, 0);
});
