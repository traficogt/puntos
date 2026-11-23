import { test } from "node:test";
import assert from "node:assert/strict";
import { giftCardTerms, loadBonus, walletProgram } from "../../src/app/services/wallet-model.js";

test("giftCardTerms: null unless the business runs GIFT_CARD", () => {
  assert.equal(giftCardTerms(null), null);
  assert.equal(giftCardTerms({ program_type: "CASHBACK" }), null);
  assert.deepEqual(
    giftCardTerms({ program_type: "GIFT_CARD", program_json: { load_bonus_percent: 10 } }),
    { bonus_percent: 10 },
  );
  assert.deepEqual(giftCardTerms({ program_type: "GIFT_CARD", program_json: {} }), {
    bonus_percent: 0,
  });
});

test("giftCardTerms: clamps the bonus to 0..100", () => {
  assert.equal(
    giftCardTerms({ program_type: "GIFT_CARD", program_json: { load_bonus_percent: -5 } })
      .bonus_percent,
    0,
  );
  assert.equal(
    giftCardTerms({ program_type: "GIFT_CARD", program_json: { load_bonus_percent: 150 } })
      .bonus_percent,
    100,
  );
});

test("loadBonus: percent of the amount, rounded to cents, never negative", () => {
  assert.equal(loadBonus(10, 100), 10);
  assert.equal(loadBonus(0, 100), 0);
  assert.equal(loadBonus(7.5, 33), 2.48); // 2.475 -> 2.48
  assert.equal(loadBonus(10, -5), 0);
  assert.equal(loadBonus(-10, 100), 0);
  assert.equal(loadBonus(10, NaN), 0);
  assert.equal(loadBonus(10, Infinity), 0);
  assert.equal(loadBonus(10, "100.00"), 10);
});

test("loadBonus: same exact centavo arithmetic as the gift-card ledger", () => {
  // Ties that Math.round(amount * percent) / 100 lands below: 0.29 * 50% = 0.145.
  assert.equal(Math.round(0.29 * 50) / 100, 0.14);
  assert.equal(loadBonus(50, 0.29), 0.15);
  assert.equal(loadBonus(25, 0.58), 0.15); // 0.145 -> 0.15
  assert.equal(loadBonus(5, 19.99), 1); // 0.9995 -> 1.00
  assert.equal(loadBonus(100, 19.99), 19.99);
  assert.equal(loadBonus(150, 10), 10); // percent clamps at 100
});

test("walletProgram: describes CASHBACK and GIFT_CARD, null otherwise", () => {
  assert.deepEqual(
    walletProgram({ program_type: "CASHBACK", program_json: { cashback_percent: 5 } }),
    { kind: "CASHBACK", percent: 5 },
  );
  assert.deepEqual(
    walletProgram({ program_type: "GIFT_CARD", program_json: { load_bonus_percent: 10 } }),
    { kind: "GIFT_CARD", bonus_percent: 10 },
  );
  assert.equal(walletProgram({ program_type: "SPEND", program_json: {} }), null);
  assert.equal(walletProgram(null), null);
});
