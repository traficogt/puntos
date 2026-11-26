import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { pool } from "../../src/app/database.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { hashPassword } from "../../src/utils/password-hash.js";
import { staffRoutes } from "../../src/app/routes/staff-routes.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";
const businessId = randomUUID(),
  staffId = randomUUID(),
  id = randomUUID(),
  csrf = "owner-fixture-csrf";
let server,
  origin,
  cookie,
  role,
  calls,
  mfaEnabled = false;
const original = { staff: StaffRepo.getById, query: pool.query };
before(async () => {
  const routes = await import("../../src/app/routes/admin/customers.js");
  assert.equal(
    typeof routes.createCustomerDirectoryRouter,
    "function",
    "owner directory router exists",
  );
  const password_hash = await hashPassword("fixture-private-passphrase");
  StaffRepo.getById = async () => ({
    id: staffId,
    business_id: businessId,
    role,
    active: true,
    password_hash,
    mfa_enabled: mfaEnabled,
  });
  pool.query = async () => ({ rows: [], rowCount: 0 });
  const session = await createBrowserSession({
    actorType: "STAFF",
    actorId: staffId,
    businessId,
    role: "OWNER",
  });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
  const repo = {
    list: async (args) => {
      calls.push(args);
      return { customers: [], page: args.page, limit: args.limit, total: 0, total_pages: 1 };
    },
    setTestAccount: async () => assert.fail("Unexpected marker update"),
    get: async (args) => {
      calls.push(args);
      return args.customerId === id ? { id, name: "Ana" } : null;
    },
    updateName: async (args) => {
      calls.push(args);
      return { id, name: args.name };
    },
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", routes.createCustomerDirectoryRouter(repo));
  app.use("/api", staffRoutes);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  role = "OWNER";
  calls = [];
  mfaEnabled = false;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  StaffRepo.getById = original.staff;
  pool.query = original.query;
});
async function request(path = "", options = {}) {
  const res = await fetch(`${origin}/api/admin/customers${path}`, {
    method: options.method || "GET",
    headers: {
      cookie: options.cookie ?? cookie,
      origin: options.origin ?? origin,
      "x-csrf-token": options.csrf ?? csrf,
      "content-type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
}
test("directory requires owner and never accepts a tenant selector", async () => {
  assert.equal((await request("", { cookie: "" })).status, 401);
  role = "MANAGER";
  assert.equal((await request()).status, 403);
  role = "OWNER";
  assert.equal((await request("?business_id=other")).status, 400);
  assert.equal(calls.length, 0);
});
test("search normalizes bounded pagination and returns uncached tenant-scoped data", async () => {
  const result = await request("?q=%20Ana%20&page=2&limit=10");
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store");
  assert.deepEqual(calls[0], { businessId, q: "Ana", page: 2, limit: 10 });
  for (const query of ["?page=0", "?page=10001", "?limit=101", "?q=" + "x".repeat(121), "?q=a&q=b"])
    assert.equal((await request(query)).status, 400);
});
test("customer detail validates IDs and missing customer", async () => {
  assert.equal((await request("/bad")).status, 400);
  assert.equal((await request("/" + randomUUID())).status, 404);
  assert.equal((await request("/" + id)).status, 200);
  assert.equal(calls.at(-1).businessId, businessId);
});
test("profile updates require CSRF and allow only names with a previous-value guard", async () => {
  const body = { name: "  Ana María  ", previous_name: "Ana" };
  for (const options of [{ csrf: "" }, { origin: "https://outside.invalid" }])
    assert.equal((await request("/" + id, { method: "PATCH", body, ...options })).status, 403);
  for (const extra of [
    { phone: "50255550000" },
    { points: 99 },
    { business_id: businessId },
    { name: "" },
    { name: "a\nb" },
    { previous_name: undefined },
  ])
    assert.equal(
      (await request("/" + id, { method: "PATCH", body: { ...body, ...extra } })).status,
      400,
    );
  assert.equal(calls.length, 0);
  const result = await request("/" + id, { method: "PATCH", body });
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0], {
    businessId,
    customerId: id,
    name: "Ana María",
    previousName: "Ana",
  });
});

test("a wrong reauthentication password is retryable without invalidating the browser session", async () => {
  const reauth = async (password, sessionCookie = cookie) => {
    const res = await fetch(`${origin}/api/staff/security/reauth`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await reauth("wrong", "")).status, 401);
  const wrong = await reauth("wrong");
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, "REAUTH_VERIFICATION_FAILED");
  assert.equal((await request()).status, 200);
  mfaEnabled = true;
  const mfa = await reauth("fixture-private-passphrase");
  assert.equal(mfa.status, 400);
  assert.equal(mfa.body.code, "REAUTH_VERIFICATION_FAILED");
  mfaEnabled = false;
  assert.equal((await reauth("fixture-private-passphrase")).status, 200);
});
