import test from "node:test";
import assert from "node:assert/strict";

test("route recommendations distinguish native, adapted, batch and manual workflows", async () => {
  const { recommendConnection } = await import("../src/pos-model.js");
  assert.equal(recommendConnection("loyverse", "unknown").mode, "loyverse");
  assert.equal(recommendConnection("other", "api").mode, "api");
  assert.match(recommendConnection("other", "api").detail, /adaptador/);
  assert.equal(recommendConnection("other", "csv").mode, "csv");
  assert.equal(recommendConnection("other", "unknown").mode, null);
});

test("connection comparison ignores sync progress but catches owner configuration changes", async () => {
  const { connectionSnapshot, configurationPayload } = await import("../src/pos-model.js");
  const saved = { enabled: false, mode: "api", automatic: false, has_api_key: true, loyverse: { configured: true, merchant_id: "m1", store_id: "s1" }, last_sync: null };
  assert.equal(connectionSnapshot(saved), connectionSnapshot({ ...saved, last_sync: { at: "newer" } }));
  assert.notEqual(connectionSnapshot(saved), connectionSnapshot({ ...saved, enabled: true }));
  assert.notEqual(connectionSnapshot(saved), connectionSnapshot({ ...saved, loyverse: { ...saved.loyverse, store_id: "s2" } }));
  assert.deepEqual(configurationPayload({ mode: "api", enabled: true, automatic: false }, saved), { mode: "api", enabled: true, automatic: false });
  assert.throws(() => configurationPayload({ mode: "loyverse", enabled: true, automatic: true }, { loyverse: { configured: false } }), /Loyverse/);
});

test("receipt sample uses bounded numeric inputs and rejects unpaid samples", async () => {
  const { receiptFromValues } = await import("../src/pos-model.js");
  const values = { saleId: " test ", source: "caja", customerPhone: "55554444", amountQ: 20, items: 1, status: "paid" };
  assert.deepEqual(receiptFromValues(values), { ...values, saleId: "test", currency: "GTQ" });
  for (const patch of [{ amountQ: "" }, { amountQ: -1 }, { amountQ: 0.001 }, { amountQ: 100000000 }, { items: 1.5 }, { items: 2147483648 }, { status: "unpaid" }, { customerPhone: "5".repeat(41) }])
    assert.throws(() => receiptFromValues({ ...values, ...patch }));
});

test("demo preflight and configuration are local and never expose or accept credentials", async () => {
  const { demoPos } = await import("../src/demo-pos.js");
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("Demo must never call a remote service");
  const call = (path, method = "GET", body) => demoPos(new URL(path, "https://example.invalid"), { method, body: JSON.stringify(body) });
  try {
    const sale = { saleId: "sample", source: "caja", customerPhone: "55554444", amountQ: 20, items: 1, currency: "GTQ", status: "paid" };
    assert.equal(call("/api/admin/pos/preflight", "POST", sale).summary.ready, 1);
    assert.equal(call("/api/admin/pos/preflight", "POST", { ...sale, amountQ: 75 }).rows[0].points, 8);
    assert.equal(call("/api/admin/pos/preflight", "POST", { ...sale, customerPhone: "55559999" }).summary.errors, 1);
    assert.equal(call("/api/admin/pos").integration.enabled, false);
    call("/api/admin/pos", "PUT", { mode: "csv", enabled: true, automatic: false });
    assert.equal(call("/api/admin/pos").integration.mode, "csv");
    assert.equal(call("/api/admin/pos").integration.has_api_key, false);
    assert.throws(() => call("/api/admin/pos", "PUT", { mode: "loyverse", enabled: true, loyverse: { access_token: "should-not-be-accepted" } }), /demostración/);
    assert.throws(() => call("/api/admin/pos/key", "POST", {}), /demostración/);
  } finally { globalThis.fetch = oldFetch; }
});
