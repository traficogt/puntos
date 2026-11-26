// PATCH /api/admin/customers/:id/test-account: owner-only, CSRF-protected, strict body,
// audited. Mirrors the owner-customers-routes fixture (session cookie + stubbed staff).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { pool } from "../../src/app/database.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";
import {
  CustomerTestAccountSchema,
  createCustomerDirectoryRouter,
} from "../../src/app/routes/admin/customers.js";

const businessId = randomUUID(),
  staffId = randomUUID(),
  id = randomUUID(),
  csrf = "test-account-fixture-csrf";
let server, origin, cookie, role, calls, missing;
const original = { staff: StaffRepo.getById, query: pool.query };
before(async () => {
  StaffRepo.getById = async () => ({ id: staffId, business_id: businessId, role, active: true });
  pool.query = async () => ({ rows: [], rowCount: 0 });
  const session = await createBrowserSession({
    actorType: "STAFF",
    actorId: staffId,
    businessId,
    role: "OWNER",
  });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
  const repo = {
    list: async () => ({ customers: [], page: 1, limit: 25, total: 0, total_pages: 1 }),
    get: async () => null,
    updateName: async () => ({ id, name: "Ana" }),
    setTestAccount: async (args, actor) => {
      calls.push({ args, actor });
      if (missing) {
        const { notFound } = await import("../../src/utils/http-error.js");
        throw notFound("No encontramos este cliente en tu negocio.");
      }
      return { id, is_test: args.isTest };
    },
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", createCustomerDirectoryRouter(repo));
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  role = "OWNER";
  calls = [];
  missing = false;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  StaffRepo.getById = original.staff;
  pool.query = original.query;
});
async function patch(customerId, body, options = {}) {
  const res = await fetch(`${origin}/api/admin/customers/${customerId}/test-account`, {
    method: "PATCH",
    headers: {
      cookie: options.cookie ?? cookie,
      origin: options.origin ?? origin,
      "x-csrf-token": options.csrf ?? csrf,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("the body schema accepts exactly { is_test: boolean }", () => {
  assert.equal(CustomerTestAccountSchema.safeParse({ is_test: true }).success, true);
  assert.equal(CustomerTestAccountSchema.safeParse({ is_test: false }).success, true);
  for (const bad of [{}, { is_test: "true" }, { is_test: 1 }, { is_test: true, name: "x" }])
    assert.equal(CustomerTestAccountSchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test("the owner marks and unmarks a customer; the change is audited with the actor", async () => {
  const marked = await patch(id, { is_test: true });
  assert.equal(marked.status, 200);
  assert.deepEqual(marked.body.customer, { id, is_test: true });
  assert.deepEqual(calls[0].args, { businessId, customerId: id, isTest: true });
  assert.equal(calls[0].actor.type, "STAFF");
  assert.equal(calls[0].actor.id, staffId);

  const unmarked = await patch(id, { is_test: false });
  assert.equal(unmarked.status, 200);
  assert.equal(unmarked.body.customer.is_test, false);
});

test("staff below owner cannot mark accounts and nothing is written or audited", async () => {
  for (const staffRole of ["MANAGER", "CASHIER"]) {
    role = staffRole;
    assert.equal((await patch(id, { is_test: true })).status, 403, staffRole);
  }
  assert.equal((await patch(id, { is_test: true }, { cookie: "" })).status, 401);
  assert.equal(calls.length, 0);
});

test("CSRF and a strict body are required; unknown customers answer 404", async () => {
  for (const options of [{ csrf: "" }, { origin: "https://outside.invalid" }])
    assert.equal((await patch(id, { is_test: true }, options)).status, 403);
  for (const body of [undefined, {}, { is_test: "yes" }, { is_test: true, points: 0 }]) {
    const result = await patch(id, body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.body.code, "VALIDATION_ERROR");
  }
  assert.equal((await patch("not-a-uuid", { is_test: true })).status, 400);
  assert.equal(calls.length, 0);
  missing = true;
  const gone = await patch(randomUUID(), { is_test: true });
  assert.equal(gone.status, 404);
});
