import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { analyticsRedemptionRoutes } from "../../src/app/routes/analytics/redemptions.js";
import { pool } from "../../src/app/database.js";

pool.query = async (sql) => {
  const text = String(sql);
  if (text.includes("FROM rewards") && text.includes("WHERE id = $1")) {
    return {
      rows: [{
        id: "reward-1",
        business_id: "biz-1",
        name: "Free Coffee",
        description: "Reward",
        points_cost: 10,
        active: true,
        stock: 20
      }],
      rowCount: 1
    };
  }
  if (text.includes("FROM redemptions r") && text.includes("WHERE r.reward_id = $1")) {
    return {
      rows: [{
        id: "red-1",
        created_at: "2026-03-08T01:00:00.000Z",
        status: "REDEEMED",
        code: "ABC123",
        points_cost: 10,
        customer_name: "Customer One",
        customer_phone: "+50255550000",
        linked_points_total: -10,
        linked_transaction_count: 1
      }],
      rowCount: 1
    };
  }
  if (text.includes("FROM redemptions r") && text.includes("WHERE r.id = $1")) {
    return {
      rows: [{
        id: "red-1",
        created_at: "2026-03-08T01:00:00.000Z",
        status: "REDEEMED",
        code: "ABC123",
        points_cost: 10,
        business_id: "biz-1",
        customer_id: "cust-1",
        reward_id: "reward-1",
        staff_user_id: "staff-1",
        customer_name: "Customer One",
        customer_phone: "+50255550000",
        reward_name: "Free Coffee",
        reward_description: "Reward",
        staff_name: "Manager One"
      }],
      rowCount: 1
    };
  }
  if (text.includes("FROM transactions") && text.includes("meta->>'redemption_id' = $3")) {
    return {
      rows: [{
        id: "tx-1",
        created_at: "2026-03-08T01:00:01.000Z",
        source: "redeem",
        status: "POSTED",
        amount_q: 0,
        points: -10,
        original_transaction_id: null,
        reversed_transaction_id: null,
        reversal_reason: null,
        meta: { redemption_id: "red-1" }
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
  const layer = analyticsRedemptionRoutes.stack.find((entry) => entry.route?.path === routePath);
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

describe("analytics redemption routes", () => {
  it("returns reward-level recent redemptions with mismatch summary", async () => {
    const res = await runRoute("/admin/analytics/rewards/:id/redemptions", {
      method: "GET",
      path: "/admin/analytics/rewards/reward-1/redemptions",
      url: "/admin/analytics/rewards/reward-1/redemptions",
      originalUrl: "/admin/analytics/rewards/reward-1/redemptions",
      tenantId: "biz-1",
      params: { id: "reward-1" }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.reward.id, "reward-1");
    assert.equal(res.body.summary.recent_redemption_count, 1);
    assert.equal(res.body.summary.mismatch_count, 0);
    assert.equal(res.body.recent_redemptions.length, 1);
  });

  it("returns redemption drilldown with linked transaction consistency", async () => {
    const res = await runRoute("/admin/analytics/redemptions/:id", {
      method: "GET",
      path: "/admin/analytics/redemptions/red-1",
      url: "/admin/analytics/redemptions/red-1",
      originalUrl: "/admin/analytics/redemptions/red-1",
      tenantId: "biz-1",
      params: { id: "red-1" }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.redemption.id, "red-1");
    assert.equal(res.body.ledger.expected_points_total, -10);
    assert.equal(res.body.ledger.linked_points_total, -10);
    assert.equal(res.body.ledger.consistent, true);
    assert.equal(res.body.transactions.length, 1);
  });
});
