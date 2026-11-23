import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { adminAuditRoutes } from "../../src/app/routes/admin/audit.js";
import { pool } from "../../src/app/database.js";

pool.query = async (sql) => {
  const text = String(sql);
  if (text.includes("FROM audit_logs a") && text.includes("a.id = $2")) {
    return {
      rows: [
        {
          id: "audit-1",
          created_at: "2026-03-08T06:00:00.000Z",
          actor_type: "STAFF",
          actor_id: "staff-1",
          action: "award.refund",
          meta: {
            transaction_id: "tx-1",
            reversal_transaction_id: "tx-2",
            redemption_id: "red-1",
          },
          actor_name: "Manager One",
          actor_email: "manager@example.com",
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM transactions t") && text.includes("t.id = $2")) {
    if (text.includes("[business_id = $1")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("t.id = $2")) {
      return {
        rows: [
          {
            id: "tx-1",
            customer_name: "Customer One",
            customer_phone: "+50255550000",
            source: "award",
            status: "REVERSED",
            points: 50,
            reversal_reason: null,
          },
        ],
        rowCount: 1,
      };
    }
  }
  if (text.includes("FROM redemptions r")) {
    return {
      rows: [
        {
          id: "red-1",
          code: "ABC123",
          reward_name: "Free Coffee",
          customer_name: "Customer One",
          customer_phone: "+50255550000",
          points_cost: 10,
        },
      ],
      rowCount: 1,
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
    },
  };
}

async function runRoute(routePath, req) {
  const layer = adminAuditRoutes.stack.find((entry) => entry.route?.path === routePath);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  const res = /** @type {any} */ (makeRes());
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  await new Promise((resolve, reject) => {
    try {
      const maybe = handler(req, res, (err) => (err ? reject(err) : resolve(undefined)));
      if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
      else resolve(undefined);
    } catch (error) {
      reject(error);
    }
  });
  return res;
}

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";

describe("admin audit detail route", () => {
  it("rejects a non-UUID audit event id before querying", () => {
    const layer = adminAuditRoutes.stack.find((entry) => entry.route?.path === "/admin/audit/:id");
    const validateParams = layer.route.stack.find((entry) => entry.name === "validateParams");
    assert.ok(validateParams, "Expected a validateParams layer");
    const res = /** @type {any} */ (makeRes());
    let nextCalled = false;
    validateParams.handle(/** @type {any} */ ({ params: { id: "audit-1" } }), res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "VALIDATION_ERROR");
    assert.equal(res.body.details[0].field, "id");
  });

  it("returns linked operational context for an audit event", async () => {
    const res = await runRoute("/admin/audit/:id", {
      method: "GET",
      path: `/admin/audit/${AUDIT_ID}`,
      url: `/admin/audit/${AUDIT_ID}`,
      originalUrl: `/admin/audit/${AUDIT_ID}`,
      tenantId: "biz-1",
      validatedParams: { id: AUDIT_ID },
      params: { id: AUDIT_ID },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.event.id, "audit-1");
    assert.equal(res.body.linked.transaction.id, "tx-1");
    assert.equal(res.body.linked.redemption.id, "red-1");
  });
});
