import { test } from "node:test";
import assert from "node:assert/strict";
import { cashbackTerms } from "../../src/app/services/cashback-model.js";
import { computePoints } from "../../src/app/services/points-service.js";

test("cashbackTerms: null for non-cashback programs", () => {
  assert.equal(cashbackTerms({ program_type: "SPEND", program_json: {} }, { amount_q: 100 }), null);
  assert.equal(cashbackTerms(null, { amount_q: 100 }), null);
});

test("cashbackTerms: null when cashback not configured", () => {
  assert.equal(
    cashbackTerms({ program_type: "CASHBACK", program_json: {} }, { amount_q: 100 }),
    null,
  );
  assert.equal(
    cashbackTerms(
      { program_type: "CASHBACK", program_json: { cashback_percent: 0 } },
      { amount_q: 100 },
    ),
    null,
  );
});

test("cashbackTerms: earns percent of the purchase", () => {
  const t = cashbackTerms(
    { program_type: "CASHBACK", program_json: { cashback_percent: 5 } },
    { amount_q: 100 },
  );
  assert.deepEqual(t, { percent: 5, earn_q: 5 });
});

test("cashbackTerms: rounds earned credit to the nearest cent", () => {
  // 37.50 * 5% = 1.875 -> 1.88
  const t = cashbackTerms(
    { program_type: "CASHBACK", program_json: { cashback_percent: 5 } },
    { amount_q: 37.5 },
  );
  assert.equal(t.earn_q, 1.88);
});

test("cashbackTerms: clamps percent to 100 and amount to >= 0", () => {
  const over = cashbackTerms(
    { program_type: "CASHBACK", program_json: { cashback_percent: 250 } },
    { amount_q: 10 },
  );
  assert.equal(over.percent, 100);
  assert.equal(over.earn_q, 10);
  const neg = cashbackTerms(
    { program_type: "CASHBACK", program_json: { cashback_percent: 5 } },
    { amount_q: -40 },
  );
  assert.equal(neg.earn_q, 0);
});

test("engine: a CASHBACK purchase awards zero points", () => {
  const business = {
    program_type: "CASHBACK",
    program_json: { cashback_percent: 5 },
    region: "GT",
  };
  assert.equal(computePoints(business, { amount_q: 100 }), 0);
});
