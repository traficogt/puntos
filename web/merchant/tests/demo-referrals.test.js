import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReferrals } from "../src/demo-referrals.js";
const url = (path) => new URL(path, "https://preview.invalid");

test("synthetic referral settings save locally without rewriting historical results", () => {
  const before = demoReferrals(url("/api/admin/referral-growth"));
  const initial = demoReferrals(url("/api/admin/referral-settings"));
  const changed = {
    ...initial.settings,
    referrer_reward_points: 75,
    reward_on_signup: true,
  };
  const saved = demoReferrals(url("/api/admin/referral-settings"), {
    method: "PUT",
    body: JSON.stringify(changed),
  });
  assert.equal(saved.settings.referrer_reward_points, 75);
  assert.equal(
    demoReferrals(url("/api/admin/referral-settings")).settings
      .reward_on_signup,
    true,
  );
  assert.deepEqual(demoReferrals(url("/api/admin/referral-growth")), before);
  saved.settings.referrer_reward_points = 999;
  assert.equal(
    demoReferrals(url("/api/admin/referral-settings")).settings
      .referrer_reward_points,
    75,
  );
  assert.equal(
    demoReferrals(url("/api/admin/referral-settings"), {
      method: "PUT",
      body: JSON.stringify({ ...changed, min_purchase_to_complete: null }),
    }).settings.min_purchase_to_complete,
    null,
  );
});
test("demo cohort and purchase filters preserve totals, pagination and honest reward states", () => {
  const all = demoReferrals(
    url("/api/admin/referral-growth?days=90&limit=100"),
  );
  const pending = demoReferrals(
    url("/api/admin/referral-growth?days=90&phase=awaiting_purchase&limit=2"),
  );
  assert.deepEqual(pending.summary, all.summary);
  assert.equal(pending.referrals.length, 2);
  assert.ok(pending.referrals.every((row) => row.first_purchase_at === null));
  assert.ok(pending.pagination.has_more);
  const second = demoReferrals(
    url(
      "/api/admin/referral-growth?days=90&phase=awaiting_purchase&limit=2&offset=2",
    ),
  );
  assert.notEqual(second.referrals[0].id, pending.referrals[0].id);
  assert.ok(
    all.summary.registered >
      demoReferrals(url("/api/admin/referral-growth?days=30")).summary
        .registered,
  );
  assert.ok(
    all.referrals.some(
      (row) => row.status === "rewarded" && !row.first_purchase_at,
    ),
  );
});
test("demo rejects unknown routes, writes and invalid settings rather than falling through", () => {
  assert.throws(() => demoReferrals(url("/api/admin/not-referrals")));
  assert.throws(() =>
    demoReferrals(url("/api/admin/referral-growth"), { method: "PUT" }),
  );
  assert.throws(() =>
    demoReferrals(url("/api/admin/referral-settings"), {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    }),
  );
});
