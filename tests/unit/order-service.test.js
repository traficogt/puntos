import test from "node:test";
import assert from "node:assert/strict";

const { processOrderWithDeps } = await import("../../src/app/services/order-service.js");

test("returns replay success when the same externalOrderId is received with the same payload", async () => {
  let lookupCalled = false;
  let lookupParams = null;
  let customerLookupCalled = false;
  let fingerprintCurrency = null;
  let tenantId = null;
  const queries = [];
  const deps = {
    withTransaction: async (fn) => fn({
      query: async (sql) => {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      }
    }),
    setCurrentTenant: async (businessId) => {
      tenantId = businessId;
    },
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe" }),
      getById: async () => ({ id: "biz-1", plan: "NEGOCIO", program_type: "SPEND", program_json: { points_per_q: 0.1 } })
    },
    CustomerRepo: {
      getById: async () => {
        customerLookupCalled = true;
        return { id: "cust-1", business_id: "biz-1" };
      },
      getByBusinessAndPhone: async () => {
        customerLookupCalled = true;
        return null;
      }
    },
    OrderRepo: {
      findByBusinessAndExternalId: async (_client, businessId, externalOrderId) => {
        lookupCalled = true;
        lookupParams = [businessId, externalOrderId];
        return {
          id: "order-existing",
          customer_id: "cust-1",
          transaction_id: "tx-existing",
          points_awarded: 5,
          transaction_status: "POSTED",
          fingerprint: "fp-1"
        };
      }
    },
    computePoints: () => 5,
    hashPayload: (payload) => {
      fingerprintCurrency = payload.currency;
      return "fp-1";
    }
  };

  const out = await processOrderWithDeps(deps, {
    businessSlug: "cafe",
    externalOrderId: "ord-1",
    customerId: "cust-1",
    status: "paid",
    amount_q: 50,
    currency: "gtq"
  });

  assert.equal(lookupCalled, true);
  assert.deepEqual(lookupParams, ["biz-1", "ord-1"]);
  assert.equal(customerLookupCalled, false);
  assert.equal(fingerprintCurrency, "GTQ");
  assert.equal(tenantId, "biz-1");
  assert.equal(queries[0].includes("pg_advisory_xact_lock"), true);
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

test("falls back to customerPhone when customerId is absent", async () => {
  let tenantId = null;
  const customerPhones = [];
  const deps = {
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
    setCurrentTenant: async (businessId) => {
      tenantId = businessId;
    },
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe" }),
      getById: async () => ({ id: "biz-1", plan: "NEGOCIO", program_type: "SPEND", program_json: { points_per_q: 0.1, pending_points_hold_days: 2 } })
    },
    CustomerRepo: {
      getById: async () => null,
      getByBusinessAndPhone: async (businessId, phone) => {
        customerPhones.push(phone);
        return { id: "cust-phone", business_id: businessId, phone };
      }
    },
    OrderRepo: {
      findByBusinessAndExternalId: async () => null,
      create: async (_client, input) => ({ id: "order-created", transaction_id: input.transaction_id })
    },
    computePoints: () => 8,
    hashPayload: () => "fp-2"
  };

  const out = await processOrderWithDeps(deps, {
    businessSlug: "cafe",
    customerPhone: "5555-4444",
    externalOrderId: "ord-phone",
    status: "completed",
    amount_q: 80
  });

  assert.equal(tenantId, "biz-1");
  assert.deepEqual(customerPhones, ["50255554444"]);
  assert.equal(out.customerId, "cust-phone");
  assert.equal(out.pointsAwarded, 8);
  assert.equal(out.status, "PENDING");
});

test("falls back to customerPhone when customerId belongs to a different business", async () => {
  const deps = {
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
    setCurrentTenant: async () => {},
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe" }),
      getById: async () => ({ id: "biz-1", plan: "NEGOCIO", program_type: "SPEND", program_json: { points_per_q: 0.1 } })
    },
    CustomerRepo: {
      getById: async () => ({ id: "cust-other", business_id: "biz-2" }),
      getByBusinessAndPhone: async (businessId, phone) => ({ id: "cust-phone", business_id: businessId, phone })
    },
    OrderRepo: {
      findByBusinessAndExternalId: async () => null,
      create: async (_client, input) => ({ id: "order-created", transaction_id: input.transaction_id })
    },
    computePoints: () => 8,
    hashPayload: () => "fp-4"
  };

  const out = await processOrderWithDeps(deps, {
    businessSlug: "cafe",
    customerId: "cust-other",
    customerPhone: "+50255554444",
    externalOrderId: "ord-phone-fallback",
    status: "paid",
    amount_q: 80
  });

  assert.equal(out.customerId, "cust-phone");
  assert.equal(out.pointsAwarded, 8);
});

test("rejects unsupported order status", async () => {
  const deps = {
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
    setCurrentTenant: async () => {},
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe" }),
      getById: async () => ({ id: "biz-1", plan: "NEGOCIO", program_type: "SPEND", program_json: { points_per_q: 0.1 } })
    },
    CustomerRepo: {
      getById: async () => ({ id: "cust-1", business_id: "biz-1" }),
      getByBusinessAndPhone: async () => null
    },
    OrderRepo: {
      findByBusinessAndExternalId: async () => {
        throw new Error("OrderRepo should not be called for unsupported status");
      }
    },
    computePoints: () => 0,
    hashPayload: () => "fp-3"
  };

  await assert.rejects(
    () => processOrderWithDeps(deps, {
      businessSlug: "cafe",
      customerId: "cust-1",
      externalOrderId: "ord-bad-status",
      status: "pending",
      amount_q: 10
    }),
    /Unsupported order status/
  );
});
