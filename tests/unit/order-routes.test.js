import test from "node:test";
import assert from "node:assert/strict";

const { OrderCreateSchema } = await import("../../src/app/routes/order-routes.js");

test("order create schema accepts identifier-based customer resolution", () => {
  const parsed = OrderCreateSchema.safeParse({
    businessSlug: "cafe",
    externalOrderId: "ord-identifier",
    identifierType: "loyalty_card",
    identifierValue: "ABC123",
    status: "paid",
    amount_q: 50
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.identifierType, "loyalty_card");
  assert.equal(parsed.data.identifierValue, "ABC123");
});

test("order create schema rejects requests without any customer identity", () => {
  const parsed = OrderCreateSchema.safeParse({
    businessSlug: "cafe",
    externalOrderId: "ord-missing",
    status: "paid",
    amount_q: 50
  });

  assert.equal(parsed.success, false);
});
