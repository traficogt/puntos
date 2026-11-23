import test from "node:test";
import assert from "node:assert/strict";
import { calculateSimple } from "../../public/calculator/simple-model.js";
import { calculateLoyalty } from "../../public/calculator/model.js";

const base = { currency: "GTQ", rewardCost: 10, rewardCount: 20 };
test("two numbers give a reward budget without assuming expenses or sales", () => {
  const result = calculateSimple(base);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rewardBudget, 200);
  assert.equal(result.budget, 200);
  assert.equal(result.monthlyCosts, null);
  assert.equal(result.estimate, null);
  assert.equal(calculateSimple({ ...base, monthlyCosts: 99 }).budget, 299);
  assert.equal(calculateSimple({ ...base, monthlyCosts: 0 }).monthlyCosts, 0);
});
test("unknown and explicitly zero costs differ; invalid quantities and currency fail", () => {
  for (const [field, value] of [
    ["rewardCost", null],
    ["rewardCost", NaN],
    ["rewardCost", -1],
    ["rewardCount", 1.5],
    ["rewardCount", null],
    ["monthlyCosts", Infinity],
    ["currency", "BAD"],
  ]) {
    assert.ok(
      calculateSimple({ ...base, [field]: value }).errors.some((error) => error.field === field),
    );
  }
  assert.equal(calculateSimple({ ...base, rewardCost: 0 }).budget, 0);
  assert.equal(calculateSimple({ ...base, rewardCount: 0 }).budget, 0);
  assert.ok(calculateSimple({ ...base, currency: "CLP", rewardCost: 10.5 }).errors.length);
  assert.equal(calculateSimple({ ...base, currency: "CLP" }).budget, 200);
});
test("optional return reserves new earned rewards without needing percentages", () => {
  const result = calculateSimple({
    ...base,
    includeReturn: true,
    keptPerSale: 25,
    rewardEvery: 10,
    additionalSales: 10,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.estimate.rewardReserve, 1);
  assert.equal(result.estimate.availablePerSale, 24);
  assert.equal(result.estimate.breakEven, 9);
  assert.equal(result.estimate.balance, 40);
  const detailed = calculateLoyalty({
    currency: "GTQ",
    redemptionPercent: 100,
    rewards: [{ kind: "product", unitCost: 10, units: 20 }],
    costs: {},
    purchase: {
      mode: "variable",
      average: 100,
      variableCost: 75,
      allowanceMode: "amount",
      rewardAllowance: 1,
      additional: 10,
    },
  });
  assert.equal(result.estimate.breakEven, detailed.breakEven);
  assert.equal(result.estimate.balance, detailed.netContribution);
});
test("return is opt-in, unknown growth stays unknown and explicit zero shows its shortfall", () => {
  assert.equal(calculateSimple({ ...base, keptPerSale: NaN }).estimate, null);
  const input = { ...base, includeReturn: true, keptPerSale: 25, rewardEvery: 10 };
  assert.equal(calculateSimple(input).estimate.balance, null);
  assert.equal(calculateSimple({ ...input, additionalSales: 0 }).estimate.balance, -200);
  for (const [field, value] of [
    ["keptPerSale", null],
    ["rewardEvery", 0],
    ["rewardEvery", 1.5],
    ["additionalSales", -1],
    ["additionalSales", 0.5],
  ]) {
    assert.ok(
      calculateSimple({ ...input, [field]: value }).errors.some((error) => error.field === field),
    );
  }
});
test("unfavorable sales cannot produce a positive break-even claim", () => {
  for (const keptPerSale of [-10, 0, 1]) {
    const result = calculateSimple({
      ...base,
      includeReturn: true,
      keptPerSale,
      rewardEvery: 10,
      additionalSales: 5,
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.estimate.breakEven, null);
    assert.ok(result.estimate.balance <= -200);
  }
});
test("currency precision, floating boundaries, unknown totals and overflow remain bounded", () => {
  assert.ok(calculateSimple({ ...base, rewardCost: 0.000001 }).errors.length);
  assert.ok(calculateSimple({ ...base, rewardCost: 1e9, rewardCount: 1e6 }).errors.length);
  assert.ok(calculateSimple({ ...base, monthlyCosts: -1 }).errors.length);
  const result = calculateSimple({
    currency: "GTQ",
    rewardCost: 0.3,
    rewardCount: 2,
    includeReturn: true,
    keptPerSale: 0.3,
    rewardEvery: 3,
    additionalSales: 3,
  });
  assert.equal(result.estimate.breakEven, 3);
  assert.equal(result.estimate.balance, 0);
  const huge = calculateSimple({
    ...base,
    includeReturn: true,
    keptPerSale: 1e9,
    rewardEvery: 1,
    additionalSales: 1e6,
  });
  assert.ok(huge.errors.length);
});
test("fractional per-purchase reserves keep exact break-even and balance consistent", () => {
  const result = calculateSimple({
    ...base,
    rewardCost: 25.42,
    includeReturn: true,
    keptPerSale: 5.27,
    rewardEvery: 6,
    additionalSales: 492,
  });
  assert.equal(result.estimate.breakEven, 492);
  assert.equal(result.estimate.balance, 0);
  const before = calculateSimple({
    ...base,
    rewardCost: 25.42,
    includeReturn: true,
    keptPerSale: 5.27,
    rewardEvery: 6,
    additionalSales: 491,
  });
  assert.ok(before.estimate.balance < 0);
});
test("a reward cost including displaced business is reserved on every extra sale", () => {
  const result = calculateSimple({
    ...base,
    rewardCost: 55,
    includeReturn: true,
    keptPerSale: 45,
    rewardEvery: 8,
    additionalSales: 26,
  });
  assert.equal(result.budget, 1100);
  assert.equal(result.estimate.breakEven, 29);
  assert.equal(result.estimate.balance, -108.75);
});
test("the stated break-even covers the budget and one fewer purchase does not", () => {
  for (let i = 1; i <= 300; i++) {
    const input = {
      currency: "GTQ",
      rewardCost: (((i * 127) % 20000) + 1) / 100,
      rewardCount: i % 100,
      monthlyCosts: i % 30,
      includeReturn: true,
      keptPerSale: (((i * 83) % 6000) + 1) / 100,
      rewardEvery: 1 + (i % 20),
    };
    const result = calculateSimple(input);
    assert.deepEqual(result.errors, []);
    const threshold = result.estimate.breakEven;
    if (threshold === null || threshold === 0) continue;
    assert.ok(calculateSimple({ ...input, additionalSales: threshold }).estimate.balance >= 0);
    assert.ok(calculateSimple({ ...input, additionalSales: threshold - 1 }).estimate.balance < 0);
  }
});
