import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentWebhook } from "../../src/app/services/payment-webhook-normalizer.js";

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
