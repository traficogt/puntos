import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { analyticsAnomalyRoutes } from "../../src/app/routes/analytics/anomalies.js";
import { pool } from "../../src/app/database.js";

pool.query = async (sql) => {
  const text = String(sql);
  if (text.includes("WITH latest_run AS")) {
    return {
      rows: [{
        negative_balance_count: 2,
        reversals_24h: 4,
        replay_events_24h: 5,
        pending_corrections_count: 3,
        latest_reconciliation_mismatches: 1
      }],
      rowCount: 1
    };
  }
  if (text.includes("GROUP BY action")) {
    return {
      rows: [
        { action: "reward.redeem.replay", count: 3 },
        { action: "award.refund.replay", count: 2 }
      ],
      rowCount: 2
    };
  }
  if (text.includes("al.action = 'award.refund'")) {
    return {
      rows: [{ actor_name: "Manager One", actor_id: "staff-1", reversal_count: 4 }],
      rowCount: 1
    };
  }
  if (text.includes("AND cb.points < 0")) {
    return {
      rows: [{ id: "cust-1", name: "Cliente Riesgo", phone: "+50255550000", points: -10 }],
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
  const layer = analyticsAnomalyRoutes.stack.find((entry) => entry.route?.path === routePath);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  const res = /** @type {any} */ (makeRes());
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

describe("analytics anomaly routes", () => {
  it("returns anomaly summary, replay breakdown, refund actors, and negative balances", async () => {
    const res = await runRoute("/admin/analytics/anomalies", {
      method: "GET",
      path: "/admin/analytics/anomalies",
      url: "/admin/analytics/anomalies",
      originalUrl: "/admin/analytics/anomalies",
      tenantId: "biz-1"
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.summary, {
      negative_balance_count: 2,
      reversals_24h: 4,
      replay_events_24h: 5,
      pending_corrections_count: 3,
      latest_reconciliation_mismatches: 1
    });
    assert.equal(res.body.replay_breakdown.length, 2);
    assert.equal(res.body.top_refund_actors[0].actor_name, "Manager One");
    assert.equal(res.body.negative_balances[0].points, -10);
  });
});
