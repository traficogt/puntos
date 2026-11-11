import test from "node:test";
import assert from "node:assert/strict";
import { demoApi } from "../src/demo-api.js";
test("preview totals match daily data and branch changes affect sample data", async () => {
  const all = await demoApi("/api/admin/analytics/overview?days=7");
  const branch = await demoApi(
    "/api/admin/analytics/overview?days=7&branch_id=demo",
  );
  assert.equal(all.daily.length, 7);
  assert.equal(
    all.current.recorded_sales_q,
    all.daily.reduce((sum, r) => sum + r.recorded_sales_q, 0),
  );
  assert.ok(branch.current.recorded_sales_q < all.current.recorded_sales_q);
});
test("preview edits remain in memory and unsupported operations never reach fetch", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Unexpected network");
  };
  try {
    await demoApi("/api/admin/campaign-rules", {
      method: "PUT",
      body: JSON.stringify({ rules: [{ name: "Local only" }] }),
    });
    assert.equal(
      (await demoApi("/api/admin/campaign-rules")).rules[0].name,
      "Local only",
    );
    await assert.rejects(
      demoApi("/api/staff/logout", { method: "POST" }),
      /demostración/,
    );
    await assert.rejects(demoApi("/api/admin/unknown"), /demostración/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
