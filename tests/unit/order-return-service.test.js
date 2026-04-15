import test from "node:test";
import assert from "node:assert/strict";

const { processOrderReturnWithDeps } = await import("../../src/app/services/order-return-service.js");

function makeClient(handlers = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("pg_advisory_xact_lock")) {
        if (handlers.lock) return handlers.lock(sql, params);
        return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
      }

      if (sql.includes("FROM transactions") && sql.includes("FOR UPDATE")) {
        if (handlers.findTransaction) return handlers.findTransaction(sql, params);
      }

      if (sql.includes("SELECT points FROM customer_balances")) {
        if (handlers.findBalance) return handlers.findBalance(sql, params);
      }

      if (sql.includes("INSERT INTO transactions")) {
        if (handlers.insertReversal) return handlers.insertReversal(sql, params);
      }

      if (sql.includes("UPDATE customer_balances")) {
        if (handlers.updateBalance) return handlers.updateBalance(sql, params);
      }

      if (sql.includes("UPDATE transactions")) {
        if (handlers.updateTransaction) return handlers.updateTransaction(sql, params);
      }

      if (sql.includes("UPDATE orders")) {
        if (handlers.updateOrder) return handlers.updateOrder(sql, params);
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function makeDeps({
  client = makeClient(),
  business = {
    id: "biz-1",
    slug: "cafe",
    program_json: {
      balance_policy: {
        allow_negative_balance_on_refund: false
      }
    }
  },
  order = {
    id: "order-1",
    business_id: "biz-1",
    customer_id: "cust-1",
    external_order_id: "ord-1",
    transaction_id: "txn-1",
    points_awarded: 12,
    transaction_status: "PENDING"
  },
  originalReturn = null,
  existingByOrder = null,
  createReturn
} = {}) {
  let tenantId = null;
  const creates = [];

  return {
    client,
    creates,
    get tenantId() {
      return tenantId;
    },
    deps: {
      withTransaction: async (fn) => fn(client),
      setCurrentTenant: async (businessId) => {
        tenantId = businessId;
      },
      makeId: (() => {
        const ids = ["reversal-tx-1"];
        return () => ids.shift() ?? "generated-id";
      })(),
      BusinessRepo: {
        getPublicBySlug: async (slug) => ({ id: business.id, slug }),
        getById: async () => business
      },
      OrderRepo: {
        findDetailedByBusinessAndExternalId: async (_client, businessId, externalOrderId) => {
          assert.equal(businessId, business.id);
          assert.equal(externalOrderId, "ord-1");
          return order;
        }
      },
      OrderReturnRepo: {
        findByBusinessAndExternalId: async () => originalReturn,
        findByOrderId: async () => existingByOrder,
        create: async (_client, input) => {
          creates.push(input);
          if (createReturn) return createReturn(input);
          return {
            id: "return-1",
            ...input
          };
        }
      },
      hashPayload: () => "return-fp-1"
    }
  };
}

test("cancels pending points and records a pending cancellation return", async () => {
  const client = makeClient({
    findTransaction: async () => ({
      rows: [{
        id: "txn-1",
        business_id: "biz-1",
        customer_id: "cust-1",
        branch_id: "branch-1",
        points: 12,
        status: "PENDING"
      }],
      rowCount: 1
    }),
    updateBalance: async () => ({ rows: [], rowCount: 1 }),
    updateTransaction: async () => ({ rows: [], rowCount: 1 }),
    updateOrder: async () => ({ rows: [], rowCount: 1 })
  });
  const ctx = makeDeps({ client });

  const out = await processOrderReturnWithDeps(ctx.deps, {
    businessSlug: "cafe",
    externalReturnId: "ret-1",
    externalOrderId: "ord-1",
    reason: "customer_refund",
    meta: { source: "pos" }
  });

  assert.equal(ctx.tenantId, "biz-1");
  assert.equal(client.calls[0].sql.includes("pg_advisory_xact_lock"), true);
  assert.equal(client.calls.some(({ sql }) => sql.includes("INSERT INTO transactions")), false);
  assert.equal(ctx.creates.length, 1);
  assert.equal(ctx.creates[0].outcome, "PENDING_CANCELLED");
  assert.equal(ctx.creates[0].points_effect, -12);
  assert.equal(ctx.creates[0].reversal_transaction_id, null);
  assert.deepEqual(out, {
    ok: true,
    orderReturnId: "return-1",
    orderId: "order-1",
    customerId: "cust-1",
    outcome: "PENDING_CANCELLED",
    pointsEffect: -12,
    reversalTransactionId: null
  });
});

test("reverses posted points and records a reversal transaction", async () => {
  let reversalInsertParams = null;
  const client = makeClient({
    findTransaction: async () => ({
      rows: [{
        id: "txn-1",
        business_id: "biz-1",
        customer_id: "cust-1",
        branch_id: "branch-1",
        points: 15,
        status: "POSTED"
      }],
      rowCount: 1
    }),
    findBalance: async () => ({
      rows: [{ points: 30 }],
      rowCount: 1
    }),
    insertReversal: async (_sql, params) => {
      reversalInsertParams = params;
      return { rows: [], rowCount: 1 };
    },
    updateBalance: async () => ({ rows: [], rowCount: 1 }),
    updateTransaction: async () => ({ rows: [], rowCount: 1 }),
    updateOrder: async () => ({ rows: [], rowCount: 1 })
  });
  const ctx = makeDeps({
    client,
    order: {
      id: "order-1",
      business_id: "biz-1",
      customer_id: "cust-1",
      external_order_id: "ord-1",
      transaction_id: "txn-1",
      points_awarded: 15,
      transaction_status: "POSTED"
    }
  });

  const out = await processOrderReturnWithDeps(ctx.deps, {
    businessSlug: "cafe",
    externalReturnId: "ret-1",
    externalOrderId: "ord-1",
    reason: "customer_refund",
    meta: { source: "pos" }
  });

  assert.ok(Array.isArray(reversalInsertParams));
  assert.equal(reversalInsertParams[0], "reversal-tx-1");
  assert.equal(reversalInsertParams[7], -15);
  assert.equal(reversalInsertParams[8], "txn-1");
  assert.deepEqual(reversalInsertParams[9], {
    external_return_id: "ret-1",
    external_order_id: "ord-1",
    refund_reason: "customer_refund",
    original_status: "POSTED",
    original_points: 15
  });
  assert.equal(ctx.creates[0].outcome, "POSTED_REVERSED");
  assert.equal(ctx.creates[0].points_effect, -15);
  assert.equal(ctx.creates[0].reversal_transaction_id, "reversal-tx-1");
  assert.deepEqual(out, {
    ok: true,
    orderReturnId: "return-1",
    orderId: "order-1",
    customerId: "cust-1",
    outcome: "POSTED_REVERSED",
    pointsEffect: -15,
    reversalTransactionId: "reversal-tx-1"
  });
});

test("returns replay success when the same externalReturnId is received with the same payload", async () => {
  const ctx = makeDeps({
    originalReturn: {
      id: "return-1",
      order_id: "order-1",
      customer_id: "cust-1",
      fingerprint: "return-fp-1",
      reversal_transaction_id: "reversal-tx-1",
      points_effect: -15,
      outcome: "POSTED_REVERSED"
    }
  });

  const out = await processOrderReturnWithDeps(ctx.deps, {
    businessSlug: "cafe",
    externalReturnId: "ret-1",
    externalOrderId: "ord-1",
    reason: "customer_refund",
    meta: { source: "pos" }
  });

  assert.equal(ctx.creates.length, 0);
  assert.deepEqual(out, {
    ok: true,
    orderReturnId: "return-1",
    orderId: "order-1",
    customerId: "cust-1",
    outcome: "POSTED_REVERSED",
    pointsEffect: -15,
    reversalTransactionId: "reversal-tx-1",
    replay: true
  });
});

test("rejects replay when the same externalReturnId is reused with a different payload", async () => {
  const ctx = makeDeps({
    originalReturn: {
      id: "return-1",
      order_id: "order-1",
      customer_id: "cust-1",
      fingerprint: "different-fingerprint",
      reversal_transaction_id: null,
      points_effect: -12,
      outcome: "PENDING_CANCELLED"
    }
  });

  await assert.rejects(
    () => processOrderReturnWithDeps(ctx.deps, {
      businessSlug: "cafe",
      externalReturnId: "ret-1",
      externalOrderId: "ord-1",
      reason: "different_reason"
    }),
    (err) => err?.statusCode === 409 && /different payload/i.test(err.message)
  );
});

test("rejects when the original order is missing", async () => {
  const ctx = makeDeps({ order: null });

  await assert.rejects(
    () => processOrderReturnWithDeps(ctx.deps, {
      businessSlug: "cafe",
      externalReturnId: "ret-1",
      externalOrderId: "ord-1"
    }),
    (err) => err?.statusCode === 404 && /order not found/i.test(err.message)
  );
});

test("rejects when the original order already has a return", async () => {
  const ctx = makeDeps({
    existingByOrder: {
      id: "return-existing",
      order_id: "order-1",
      customer_id: "cust-1"
    }
  });

  await assert.rejects(
    () => processOrderReturnWithDeps(ctx.deps, {
      businessSlug: "cafe",
      externalReturnId: "ret-2",
      externalOrderId: "ord-1"
    }),
    (err) => err?.statusCode === 409 && /already returned/i.test(err.message)
  );
});

test("rejects when a posted reversal would require a negative balance and policy forbids it", async () => {
  const client = makeClient({
    findTransaction: async () => ({
      rows: [{
        id: "txn-1",
        business_id: "biz-1",
        customer_id: "cust-1",
        branch_id: "branch-1",
        points: 15,
        status: "POSTED"
      }],
      rowCount: 1
    }),
    findBalance: async () => ({
      rows: [{ points: 5 }],
      rowCount: 1
    })
  });
  const ctx = makeDeps({
    client,
    order: {
      id: "order-1",
      business_id: "biz-1",
      customer_id: "cust-1",
      external_order_id: "ord-1",
      transaction_id: "txn-1",
      points_awarded: 15,
      transaction_status: "POSTED"
    }
  });

  await assert.rejects(
    () => processOrderReturnWithDeps(ctx.deps, {
      businessSlug: "cafe",
      externalReturnId: "ret-1",
      externalOrderId: "ord-1",
      reason: "customer_refund"
    }),
    (err) => err?.statusCode === 409 && /negative balance|manual/i.test(err.message)
  );
});
