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
