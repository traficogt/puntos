import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { analyticsCustomerRoutes } from "../../src/app/routes/analytics/customer-360.js";
import { pool } from "../../src/app/database.js";

pool.query = async (sql) => {
  const text = String(sql);
  if (text.includes("COALESCE(cb.points, 0)::int AS stored_points")) {
    return {
      rows: [{
        customer_id: "cust-1",
        business_id: "biz-1",
        name: "Customer One",
        phone: "+50255550000",
        created_at: "2026-03-01T00:00:00.000Z",
        stored_points: 80,
        stored_pending_points: 5,
        stored_lifetime_points: 140,
        expected_points: 100,
        expected_pending_points: 0,
        expected_lifetime_points: 150
      }],
      rowCount: 1
    };
  }
  if (text.includes("GROUP BY source, status")) {
    return {
      rows: [{
        source: "award",
        status: "POSTED",
        transaction_count: 3,
        total_points: 100,
        total_amount_q: "100.00"
      }],
      rowCount: 1
    };
  }
  if (text.includes("FROM transactions") && text.includes("LIMIT 50")) {
    return {
      rows: [{
        id: "tx-1",
        created_at: "2026-03-08T00:00:00.000Z",
        source: "award",
        status: "POSTED",
        amount_q: 50,
        visits: 0,
        items: 0,
        points: 50,
        original_transaction_id: null,
        reversed_transaction_id: null,
        reversal_reason: null,
        meta: { note: "test" }
      }],
      rowCount: 1
    };
  }
  if (text.includes("FROM redemptions r")) {
    return {
      rows: [{
        id: "red-1",
        created_at: "2026-03-08T01:00:00.000Z",
        status: "REDEEMED",
        code: "ABC123",
        points_cost: 10,
        reward_id: "reward-1",
        reward_name: "Free Coffee"
      }],
      rowCount: 1
    };
  }
  return { rows: [], rowCount: 0 };
};
pool.connect = async () => ({ query: pool.query, release() {} });

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function runRoute(routePath, req) {
  const layer = analyticsCustomerRoutes.stack.find((entry) => entry.route?.path === routePath);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  const res = makeRes();
  const handlers = layer.route.stack.map((entry) => entry.handle);
  for (const handler of handlers) {
    await new Promise((resolve, reject) => {
      try {
        const maybe = handler(req, res, (err) => (err ? reject(err) : resolve()));
        if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
        else if (handler.length < 3) resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
  return res;
}

describe("analytics customer ledger route", () => {
  it("returns a customer-level ledger explanation with deltas and recent events", async () => {
    const res = await runRoute("/admin/analytics/customer/:id/ledger", {
      method: "GET",
      path: "/admin/analytics/customer/cust-1/ledger",
      url: "/admin/analytics/customer/cust-1/ledger",
      originalUrl: "/admin/analytics/customer/cust-1/ledger",
      tenantId: "biz-1",
      params: { id: "cust-1" }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.customer.id, "cust-1");
    assert.equal(res.body.balances.stored.points, 80);
    assert.equal(res.body.balances.expected.points, 100);
    assert.equal(res.body.balances.delta.points, 20);
    assert.equal(res.body.balances.mismatch, true);
    assert.equal(res.body.ledger_breakdown.length, 1);
    assert.equal(res.body.recent_transactions.length, 1);
    assert.equal(res.body.recent_redemptions.length, 1);
  });
});
