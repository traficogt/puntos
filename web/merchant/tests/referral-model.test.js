import assert from "node:assert/strict";
import { test } from "node:test";
import {
  editableReferralSettings,
  referralPayload,
  validateReferralSettings,
  referralTriggerText,
  enrollmentLink,
} from "../src/referral-model.js";

const stored = {
  enabled: true,
  referrer_reward_points: 100,
  referred_reward_points: 50,
  min_purchase_to_complete: "25.50",
  reward_on_signup: false,
  custom_message: "Mensaje existente",
};
test("normalizes stored decimal settings and preserves the existing custom message", () => {
  const values = editableReferralSettings(stored);
  assert.equal(values.min_purchase_to_complete, 25.5);
  assert.deepEqual(referralPayload(values), {
    ...stored,
    min_purchase_to_complete: 25.5,
  });
  assert.equal(
    referralPayload({ ...values, min_purchase_to_complete: 0 })
      .min_purchase_to_complete,
    null,
  );
});
test("rejects blank, nonfinite, fractional or out of range incentive values before save", () => {
  const valid = editableReferralSettings(stored);
  assert.equal(validateReferralSettings(valid), null);
  for (const field of ["referrer_reward_points", "referred_reward_points"]) {
    for (const value of ["", NaN, Infinity, -1, 0.5, 100001])
      assert.ok(
        validateReferralSettings({ ...valid, [field]: value }),
        `${field} ${value}`,
      );
  }
  for (const value of ["", Infinity, -1, 0.001, 100000000])
    assert.ok(
      validateReferralSettings({ ...valid, min_purchase_to_complete: value }),
    );
  assert.equal(
    validateReferralSettings({
      ...valid,
      referrer_reward_points: 0,
      min_purchase_to_complete: 0,
    }),
    null,
  );
});
test("describes signup and accumulated-spend triggers without pretending the threshold is one ticket", () => {
  assert.match(
    referralTriggerText({ ...stored, reward_on_signup: true }),
    /aplica.*código/,
  );
  assert.match(referralTriggerText(stored), /acumulado/);
  assert.match(
    referralTriggerText({ ...stored, min_purchase_to_complete: null }),
    /procesar.*compra/,
  );
});
test("only exposes the authenticated business public enrollment link", () => {
  const business = { id: "business-a", slug: "cafeteria" };
  const valid = {
    business,
    registration_url: "https://app.example/registro/cafeteria",
  };
  assert.equal(enrollmentLink(valid, "business-a"), valid.registration_url);
  for (const registration_url of [
    // eslint-disable-next-line no-script-url -- verifies rejection of non-HTTP enrollment links
    "javascript:alert(1)",
    "https://app.example/registro/another",
    "https://user:secret@app.example/registro/cafeteria",
    "https://app.example/registro/cafeteria?token=secret",
    "https://app.example/registro/cafeteria#anything",
  ])
    assert.equal(
      enrollmentLink({ business, registration_url }, "business-a"),
      "",
    );
  assert.equal(enrollmentLink(valid, "business-b"), "");
  assert.equal(enrollmentLink(null, "business-a"), "");
});
