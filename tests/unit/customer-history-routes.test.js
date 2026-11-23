import test from "node:test";
import assert from "node:assert/strict";
import { customerRoutes } from "../../src/app/routes/customer-routes.js";
import { TxnRepo } from "../../src/app/repositories/transaction-repository.js";
import { RedemptionRepo } from "../../src/app/repositories/redemption-repository.js";
import { CustomerRepo } from "../../src/app/repositories/customer-repository.js";
import { runWithDbContext } from "../../src/app/database.js";
import { requireCustomer } from "../../src/middleware/auth.js";
import { tenantContext } from "../../src/middleware/tenant.js";

const route = customerRoutes.stack.find((layer) => layer.route?.path === "/customer/history").route;
const handler = route.stack.at(-1).handle;
const stored = {
  id: "tx",
  business_id: "business-a",
  customer_id: "customer-a",
  branch_id: null,
  staff_user_id: "PRIVATE_STAFF",
  amount_q: "0.00",
  points_delta: 10,
  type: "ACHIEVEMENT",
  source: "online",
  created_at: "2026-11-16T12:00:00Z",
  status: "PENDING",
  meta: { staff_note: "PRIVATE_NOTE", achievement_name: "PRIVATE_NAME" },
  reward_name: null,
};
async function call(extra = {}) {
  const queries = [],
    response = { status: 200, headers: {}, body: null };
  const req = /** @type {any} */ ({
    query: {},
    customerAuth: { id: "customer-a", business_id: "business-a" },
    tenantId: "business-a",
    ...extra,
  });
  const res = /** @type {any} */ ({
    setHeader(k, v) {
      response.headers[k] = v;
    },
    status(code) {
      response.status = code;
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
    clearCookie() {},
  });
  await runWithDbContext(
    {
      tenantId: "business-a",
      client: {
        query: async (sql, params) => {
          queries.push({ sql, params });
          return { rows: sql.includes("FROM transactions") ? [stored] : [] };
        },
      },
    },
    () =>
      handler(req, res, (error) => {
        throw error;
      }),
  );
  return { ...response, queries };
}
test("browser history retains auth/tenant guards, scopes both lists and keeps metadata private", async (t) => {
  t.mock.method(CustomerRepo, "getById", async () => ({
    id: "customer-a",
    business_id: "business-a",
  }));
  assert.equal(route.stack[0].handle, requireCustomer);
  assert.equal(route.stack[1].handle, tenantContext);
  const result = await call({ query: { customer_id: "someone-else", business_id: "another" } });
  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.equal(result.body.transactions[0].points_delta, 10);
  assert.equal(result.body.transactions[0].amount_q, "0.00");
  assert.deepEqual(result.body.transactions[0].provenance, {
    kind: "achievement_bonus",
    status: "PENDING",
    includes_bonus: false,
  });
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE|staff_user_id|meta/);
  assert.equal(result.queries.length, 2);
  for (const { sql, params } of result.queries) {
    assert.deepEqual(params, ["business-a", "customer-a", 50]);
    assert.match(sql, /business_id=\$1/);
    assert.match(sql, /customer_id=\$2/);
    assert.match(sql, /business_id=[tr]\.business_id/);
  }
  const mismatch = await call({ tenantId: "other" });
  assert.equal(mismatch.status, 404);
  assert.equal(mismatch.queries.length, 0);
});
test("native and export repository contracts keep their original fields and behavior", async () => {
  const sqls = [];
  const results = await runWithDbContext(
    {
      client: {
        query: async (sql) => {
          sqls.push(sql);
          return { rows: [stored] };
        },
      },
    },
    async () => [
      await TxnRepo.listByCustomer("customer-a"),
      await RedemptionRepo.listByCustomer("customer-a"),
    ],
  );
  assert.deepEqual(results, [[stored], [stored]]);
  assert.match(sqls[0], /t\.meta/);
  assert.doesNotMatch(sqls[0], /provenance/);
});
