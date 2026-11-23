import { test } from "node:test";
import assert from "node:assert/strict";
import { memberDiscount } from "../../src/app/services/discount-model.js";
import { evaluatePointRules } from "../../src/app/services/transaction-rule-evidence.js";

test("memberDiscount returns null for non-discount programs", () => {
  assert.equal(
    memberDiscount({ program_type: "SPEND", program_json: {} }, { amount_q: 100 }),
    null,
  );
  assert.equal(memberDiscount(null, { amount_q: 100 }), null);
});

test("memberDiscount computes a percentage off a qualifying purchase", () => {
  const b = { program_type: "DISCOUNT", program_json: { percent_off: 10 } };
  assert.deepEqual(memberDiscount(b, { amount_q: 250 }), {
    percent_off: 10,
    min_purchase_q: 0,
    amount_q: 250,
    eligible: true,
    discount_q: 25,
  });
  assert.equal(memberDiscount(b, { amount_q: 99.9 }).discount_q, 9.99);
  assert.equal(memberDiscount(b, { amount_q: 0 }).eligible, false);
});

test("memberDiscount honours a minimum purchase and clamps the percentage", () => {
  const b = { program_type: "DISCOUNT", program_json: { percent_off: 150, min_purchase_q: 50 } };
  assert.equal(memberDiscount(b, { amount_q: 40 }).eligible, false);
  assert.equal(memberDiscount(b, { amount_q: 40 }).discount_q, 0);
  assert.equal(memberDiscount(b, { amount_q: 80 }).percent_off, 100);
  assert.equal(memberDiscount(b, { amount_q: 80 }).discount_q, 80);
});

test("a discount program accrues no points and still emits valid evidence", () => {
  const now = new Date("2026-11-20T18:00:00Z");
  const result = evaluatePointRules(
    { program_type: "DISCOUNT", program_json: { percent_off: 10 } },
    { amount_q: 500 },
    { now, timeZone: "America/Guatemala" },
  );
  assert.equal(result.points, 0);
  assert.equal(result.evidence.program.type, "DISCOUNT");
  assert.equal(result.evidence.program_points, 0);
  assert.equal(result.evidence.base_points, 0);
});

test("memberDiscount: exact centavo math where float rounding misses (4.10 at 15% off = 0.62)", () => {
  const off = (amount_q, percent_off) =>
    memberDiscount({ program_type: "DISCOUNT", program_json: { percent_off } }, { amount_q })
      .discount_q;
  assert.equal(off(4.1, 15), 0.62); // Math.round(((4.1 * 15) / 100) * 100) / 100 === 0.61
  assert.equal(off(33.3, 15), 5);
  assert.equal(off(1.15, 10), 0.12);
  assert.equal(off("99.90", 10), 9.99);
});
