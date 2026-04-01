import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { analyticsLedgerRoutes } from "../../src/app/routes/analytics/ledger.js";
import { pool } from "../../src/app/database.js";

pool.query = async (sql) => {
  const text = String(sql);
  if (text.includes("FROM ledger_reconciliation_runs") && text.includes("LIMIT 1")) {
    return {
      rows: [{
        id: "run-1",
        completed_at: "2026-03-08T05:00:00.000Z",
        status: "COMPLETED",
        checked_customers: 12,
        mismatched_customers: 2,
        repaired_customers: 2,
        scope: { business_id: "biz-1" }
      }],
      rowCount: 1
    };
  }
  if (text.includes("FROM ledger_reconciliation_runs") && text.includes("LIMIT 10")) {
    return {
      rows: [{
        id: "run-1",
        completed_at: "2026-03-08T05:00:00.000Z",
        status: "COMPLETED",
        checked_customers: 12,
        mismatched_customers: 2,
        repaired_customers: 2,
        scope: { business_id: "biz-1" }
      }],
      rowCount: 1
    };
  }
  if (text.includes("FROM ledger_reconciliation_findings")) {
    return {
      rows: [{
        customer_id: "cust-1",
        business_id: "biz-1",
        stored_points: 80,
        expected_points: 100,
        stored_pending_points: 0,
        expected_pending_points: 0,
        stored_lifetime_points: 120,
        expected_lifetime_points: 140,
        delta_points: 20,
        delta_pending_points: 0,
        delta_lifetime_points: 20,
        repaired: true,
        created_at: "2026-03-08T05:00:01.000Z"
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
  const layer = analyticsLedgerRoutes.stack.find((entry) => entry.route?.path === routePath);
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

describe("analytics ledger routes", () => {
  it("returns latest reconciliation runs and findings for the tenant", async () => {
    const res = await runRoute("/admin/analytics/ledger-reconciliation", {
      method: "GET",
      path: "/admin/analytics/ledger-reconciliation",
      url: "/admin/analytics/ledger-reconciliation",
      originalUrl: "/admin/analytics/ledger-reconciliation",
      tenantId: "biz-1"
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.latest_run.id, "run-1");
    assert.equal(res.body.recent_runs.length, 1);
    assert.equal(res.body.latest_findings.length, 1);
  });
});
