import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentWebhook, parsePaymentAmount } from "../../src/app/services/payment-webhook-normalizer.js";

function eventType(fields) {
  return normalizePaymentWebhook("merchant-pos", {
    externalEventId: "receipt-123",
    amount_q: 48.5,
    ...fields
  }).eventType;
}

describe("payment webhook success classification", () => {
  for (const status of [
    "UNPAID", "NOT_APPROVED", "DISAPPROVED", "UNSUCCESSFUL",
    "PAID_FAILED", "PARTIALLY_PAID", "PAID_REFUNDED", "APPROVAL_PENDING",
    "AUTHORIZED", "PENDING", "FAILED", "CANCELLED", "REFUNDED", "unknown"
  ]) {
    it(`does not award for ${status}`, () => {
      assert.equal(eventType({ status }), "payment.other");
    });
  }

  for (const status of ["PAID", "APPROVED", "SUCCESS", "SUCCEEDED", "COMPLETED", " paid "]) {
    it(`recognizes the explicit success status ${JSON.stringify(status)}`, () => {
      assert.equal(eventType({ status }), "payment.approved");
    });
  }

  for (const event of ["payment.approved", "payment.paid", "payment.succeeded", "payment.completed"]) {
    it(`recognizes the explicit success event ${event}`, () => {
      assert.equal(eventType({ event }), "payment.approved");
    });
  }

  it("does not infer payment completion from a success substring in an event", () => {
    assert.equal(eventType({ type: "payment.unsuccessful" }), "payment.other");
    assert.equal(eventType({ event: "refund.success" }), "payment.other");
  });

  it("requires explicit payment status to agree with a success event", () => {
    assert.equal(eventType({ event: "payment.paid", payment_status: "UNPAID" }), "payment.other");
    assert.equal(eventType({ status: "PAID", payment_status: "FAILED" }), "payment.other");
  });

  it("does not award a refund notification carrying the original payment status", () => {
    assert.equal(eventType({ status: "PAID", type: "payment.refunded" }), "payment.other");
  });

  it("requires completion status for neutral payment update notifications", () => {
    assert.equal(eventType({ type: "payment.updated" }), "payment.other");
    assert.equal(eventType({ status: "COMPLETED", type: "payment.updated" }), "payment.approved");
  });

  it("does not coerce arrays or objects into a successful status", () => {
    assert.equal(eventType({ status: ["PAID"] }), "payment.other");
    assert.equal(eventType({ status: { value: "PAID" } }), "payment.other");
    assert.equal(eventType({ status: null }), "payment.other");
    assert.equal(eventType({}), "payment.other");
  });
});

describe("payment webhook amounts", () => {
  const amount = (value) => normalizePaymentWebhook("merchant-pos", { externalEventId: "receipt-123", status: "PAID", amount_q: value }).amount_q;

  for (const [value, expected] of [[48.5, 48.5], [0, 0], [10, 10], [99999999.99, 99999999.99], [0.1 + 0.2, 0.3], ["48.50", 48.5], ["7", 7], [" 12.3 ", 12.3], ["0", 0]]) {
    it(`accepts ${JSON.stringify(value)}`, () => assert.equal(amount(value), expected));
  }

  for (const value of [true, false, "", "abc", "1e3", "10,50", "-5", -5, 10.555, "10.555", Number.NaN, Infinity, "Infinity", "0x10", 100000000, "100000000", [], [10], {}, { value: 10 }]) {
    it(`rejects ${JSON.stringify(value) ?? String(value)} instead of treating it as zero`, () => assert.equal(amount(value), null));
  }

  it("treats a missing amount as invalid", () => {
    assert.equal(normalizePaymentWebhook("merchant-pos", { externalEventId: "receipt-123", status: "PAID" }).amount_q, null);
  });

  it("reads the first present amount field without falling through an invalid one", () => {
    assert.equal(normalizePaymentWebhook("cubo", { amount: "12.00", total: 99 }).amount_q, 12);
    assert.equal(normalizePaymentWebhook("cubo", { amount_q: "abc", amount: 12 }).amount_q, null);
  });
});

describe("parsePaymentAmount", () => {
  it("never coerces booleans, sub-cent values or exponent notation", () => {
    assert.deepEqual([true, 1.005, "1.005", "5e1", "1_000"].map(parsePaymentAmount), [null, null, null, null, null]);
    assert.equal(parsePaymentAmount(19.99), 19.99);
  });
});
