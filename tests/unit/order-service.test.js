import test from "node:test";
import assert from "node:assert/strict";

const { processOrderWithDeps } = await import("../../src/app/services/order-service.js");

test("returns replay success when the same externalOrderId is received with the same payload", async () => {
  let lookupCalled = false;
  const deps = {
    withTransaction: async (fn) => fn({
      query: async (sql) => {
        if (sql.includes("SELECT id, customer_id, transaction_id")) {
          lookupCalled = true;
          return {
            rows: [{
              id: "order-existing",
              customer_id: "cust-1",
              transaction_id: "tx-existing",
              points_awarded: 5,
              transaction_status: "POSTED",
              fingerprint: "fp-1"
            }],
            rowCount: 1
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    }),
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe" }),
      getById: async () => ({ id: "biz-1", plan: "NEGOCIO", program_type: "SPEND", program_json: { points_per_q: 0.1 } })
    },
    CustomerRepo: {
      getById: async () => ({ id: "cust-1", business_id: "biz-1" }),
      getByBusinessAndPhone: async () => null
    },
    computePoints: () => 5,
    hashPayload: () => "fp-1"
  };

  const out = await processOrderWithDeps(deps, {
    businessSlug: "cafe",
    externalOrderId: "ord-1",
    customerId: "cust-1",
    status: "paid",
    amount_q: 50
  });

  assert.equal(lookupCalled, true);
  assert.deepEqual(out, {
    ok: true,
    orderId: "order-existing",
    transactionId: "tx-existing",
    customerId: "cust-1",
    pointsAwarded: 5,
    status: "POSTED",
    replay: true
  });
});
