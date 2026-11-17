import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { analyticsLedgerRoutes } from "../../src/app/routes/analytics/ledger.js";
import { pool } from "../../src/app/database.js";

const queries = [];
pool.query = async (sql, params = []) => {
  const text = String(sql);
  queries.push({ text, params });
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
  const res = /** @type {any} */ (makeRes());
  const handlers = layer.route.stack.map((entry) => entry.handle);
  for (const handler of handlers) {
    await new Promise((resolve, reject) => {
      try {
        const maybe = handler(req, res, (err) => (err ? reject(err) : resolve(undefined)));
        if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
        else if (handler.length < 3) resolve(undefined);
      } catch (error) {
        reject(error);
      }
    });
    if (res.body !== null) break;
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
      tenantId: "biz-1",
      staff: { id: "staff-1", business_id: "biz-1", role: "OWNER" }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.latest_run.id, "run-1");
    assert.equal(res.body.recent_runs.length, 1);
    assert.equal(res.body.latest_findings.length, 1);
    const runQuery = queries.find((query) => query.text.includes("FROM ledger_reconciliation_runs"));
    assert.doesNotMatch(runQuery.text, /business_id IS NULL/);
    assert.deepEqual(runQuery.params, ["biz-1"]);
    const findingQuery = queries.find((query) => query.text.includes("FROM ledger_reconciliation_findings"));
    assert.match(findingQuery.text, /AND business_id = \$2/);
    assert.deepEqual(findingQuery.params, ["run-1", "biz-1"]);
  });

  it("is limited to owners like the other ledger review endpoints", async () => {
    for (const role of ["MANAGER", "CASHIER"]) {
      const res = await runRoute("/admin/analytics/ledger-reconciliation", {
        method: "GET",
        path: "/admin/analytics/ledger-reconciliation",
        tenantId: "biz-1",
        staff: { id: "staff-2", business_id: "biz-1", role }
      });
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, "RBAC_ROLE_REQUIRED");
    }
  });
});
