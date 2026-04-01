import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { adminAuditRoutes } from "../../src/app/routes/admin/audit.js";
import { pool } from "../../src/app/database.js";

pool.query = async (sql) => {
  const text = String(sql);
  if (text.includes("FROM audit_logs a") && text.includes("a.id = $2")) {
    return {
      rows: [{
        id: "audit-1",
        created_at: "2026-03-08T06:00:00.000Z",
        actor_type: "STAFF",
        actor_id: "staff-1",
        action: "award.refund",
        meta: {
          transaction_id: "tx-1",
          reversal_transaction_id: "tx-2",
          redemption_id: "red-1"
        },
        actor_name: "Manager One",
        actor_email: "manager@example.com"
      }],
      rowCount: 1
    };
  }
  if (text.includes("FROM transactions t") && text.includes("t.id = $2")) {
    if (text.includes("[business_id = $1")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("t.id = $2")) {
      return {
        rows: [{
          id: "tx-1",
          customer_name: "Customer One",
          customer_phone: "+50255550000",
          source: "award",
          status: "REVERSED",
          points: 50,
          reversal_reason: null
        }],
        rowCount: 1
      };
    }
  }
  if (text.includes("FROM redemptions r")) {
    return {
      rows: [{
        id: "red-1",
        code: "ABC123",
        reward_name: "Free Coffee",
        customer_name: "Customer One",
        customer_phone: "+50255550000",
        points_cost: 10
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
  const layer = adminAuditRoutes.stack.find((entry) => entry.route?.path === routePath);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  const res = makeRes();
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  await new Promise((resolve, reject) => {
    try {
      const maybe = handler(req, res, (err) => (err ? reject(err) : resolve()));
      if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
      else resolve();
    } catch (error) {
      reject(error);
    }
  });
  return res;
}

describe("admin audit detail route", () => {
  it("returns linked operational context for an audit event", async () => {
    const res = await runRoute("/admin/audit/:id", {
      method: "GET",
      path: "/admin/audit/audit-1",
      url: "/admin/audit/audit-1",
      originalUrl: "/admin/audit/audit-1",
      tenantId: "biz-1",
      params: { id: "audit-1" }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.event.id, "audit-1");
    assert.equal(res.body.linked.transaction.id, "tx-1");
    assert.equal(res.body.linked.redemption.id, "red-1");
  });
});
