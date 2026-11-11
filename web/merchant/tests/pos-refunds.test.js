import test from "node:test";
import assert from "node:assert/strict";
import { demoPos } from "../src/demo-pos.js";

test("demo refunds are isolated receipt examples and cannot manufacture successful reconciliation", () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => assert.fail("Refund demo must not call a server or provider");
  const call = (path, method = "GET", body) => demoPos(new URL(path, "https://example.invalid"), { method, body: JSON.stringify(body) });
  try {
    let result;
    assert.doesNotThrow(() => { result = call("/api/admin/pos/refunds"); }, "refund demo contract must exist");
    assert.equal(result.summary.total, result.refunds.length);
    const partial = result.refunds.find(row => row.reason === "partial_refund");
    assert.ok(partial);
    const retry = call(`/api/admin/pos/refunds/${partial.id}/retry`, "POST", {});
    assert.equal(retry.refund.status, "pending");
    assert.equal(retry.refund.reversal_transaction_id, null);
    assert.match(retry.refund.message, /parcial/i);
    assert.ok(call("/api/admin/pos/refunds?status=pending").refunds.every(row => row.status === "pending"));
    assert.throws(() => call(`/api/admin/pos/refunds/${partial.id}/retry`, "POST", { status: "reconciled" }), /demostración/);
    assert.throws(() => call("/api/admin/pos/refunds/unknown/retry", "POST", {}));
  } finally { globalThis.fetch = previous; }
});
