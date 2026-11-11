import test from "node:test";
import assert from "node:assert/strict";

const service = await import("../../src/app/services/pos-refund-service.js");
const input = { refundId: "r-01", originalSaleId: "s-01", source: "register-1", amountQ: 40, currency: "GTQ", scope: "full" };

test("refund contract validates receipt identity, exact cents and source without accepting customer guesses", () => {
  assert.equal(typeof service.normalizePosRefund, "function", "refund normalization must exist");
  const normalized = service.normalizePosRefund(input);
  assert.deepEqual(normalized, input);
  for (const patch of [{ customerPhone: "55554444" }, { originalSaleId: "" }, { refundId: "s-01" }, { currency: "USD" }, { amountQ: -1 }, { amountQ: 1.001 }, { source: "../bad" }, { full: true }]) {
    assert.throws(() => service.normalizePosRefund({ ...input, ...patch }), { statusCode: 400 });
  }
});

test("refund fingerprints ignore object key order but bind original, source, amount and receipt", () => {
  assert.equal(typeof service.posRefundFingerprint, "function", "stable fingerprint must exist");
  assert.equal(service.posRefundFingerprint(input), service.posRefundFingerprint(Object.fromEntries(Object.entries(input).reverse())));
  for (const patch of [{ refundId: "r-02" }, { originalSaleId: "s-02" }, { source: "register-2" }, { amountQ: 41 }, { scope: "partial" }]) {
    assert.notEqual(service.posRefundFingerprint(input), service.posRefundFingerprint({ ...input, ...patch }));
  }
});
