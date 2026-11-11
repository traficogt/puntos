import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";

import analyticsRoutes from "../../src/app/routes/analytics-routes.js";
import { pool, transactionPool } from "../../src/app/database.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { SecurityEventRepo } from "../../src/app/repositories/security-event-repository.js";
import { PlanConfigService } from "../../src/app/services/plan-config-service.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";

const businessId = randomUUID();
const staffId = randomUUID();
const runId = randomUUID();
const customerId = randomUUID();
const requestId = randomUUID();
const csrf = "recovery-csrf-test-token";
const base = "/api/admin/analytics/recovery";
const run = { id: runId, name: "Lista", notes: "", inactive_days: 30, requested_limit: 50, member_count: 1, created_at: "2026-11-10T18:00:00Z" };
let role;
let plan;
let queries;
let server;
let origin;
let cookie;
const originals = { staff: StaffRepo.getById, business: BusinessRepo.getById, plans: PlanConfigService.getPlanFeatureOverrides, query: pool.query, connect: transactionPool.connect, security: SecurityEventRepo.log };

before(async () => {
  StaffRepo.getById = async () => ({ id: staffId, business_id: businessId, role, branch_id: null, active: true });
  BusinessRepo.getById = async () => ({ id: businessId, plan });
  PlanConfigService.getPlanFeatureOverrides = async () => ({});
  SecurityEventRepo.log = async () => {};
  const query = async (sql, params) => {
    const text = String(sql);
    queries.push({ sql: text, params });
    if (text.includes("FROM businesses b")) return { rows: [{ program_json: {} }], rowCount: 1 };
    if (text.includes("INSERT INTO recovery_runs")) return { rows: [run], rowCount: 1 };
    if (text.includes("INSERT INTO recovery_members")) return { rows: [{ customer_id: customerId }], rowCount: 1 };
    if (text.includes("FOR UPDATE OF m,c")) return { rows: [{ customer_id: customerId, status: "pending", contacted_at: null }] };
    if (text.includes("UPDATE recovery_members")) return { rows: [{ customer_id: customerId, status: params[3], contacted_at: params[3] === "contacted" ? new Date() : null }] };
    if (text.includes("AS customers")) return { rows: [{ total: 0, customers: [] }] };
    if (text.includes("AS members")) return { rows: [{ run, total: 0, members: [] }] };
    if (text.includes("FROM run_results")) return { rows: [run] };
    return { rows: [], rowCount: 0 };
  };
  pool.query = /** @type {any} */ (query);
  transactionPool.connect = /** @type {any} */ (async () => ({ query, release() {} }));
  const session = await createBrowserSession({ actorType: "STAFF", actorId: staffId, businessId, role: "OWNER" });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", analyticsRoutes);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { role = "OWNER"; plan = "EMPRESA"; queries = []; });
after(async () => {
  await new Promise(resolve => server?.close(resolve));
  StaffRepo.getById = originals.staff;
  BusinessRepo.getById = originals.business;
  PlanConfigService.getPlanFeatureOverrides = originals.plans;
  SecurityEventRepo.log = originals.security;
  pool.query = originals.query;
  transactionPool.connect = originals.connect;
});
async function request(path = "/audience", { method = "GET", body = undefined, authenticated = true, token = csrf, requestOrigin = origin } = {}) {
  const headers = { "content-type": "application/json", origin: requestOrigin };
  if (authenticated) headers.cookie = cookie;
  if (token) headers["x-csrf-token"] = token;
  const response = await fetch(`${origin}${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}
const createBody = { request_id: requestId, name: " Lista ", inactive_days: 30 };
const memberPath = `/runs/${runId}/members/${customerId}`;
const operations = [
  { path: "/audience" }, { path: "/runs" }, { path: `/runs/${runId}` },
  { path: "/runs", method: "POST", body: createBody },
  { path: memberPath, method: "PATCH", body: { status: "contacted", contact_confirmed: true } }
];

describe("recovery API through authentication, plan, owner and CSRF gates", () => {
  it("exposes an empty audience to an eligible owner", async () => {
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(response.body.total, 0);
    assert.deepEqual(response.body.customers, []);
    assert.equal(response.body.count_status, "available");
    assert.equal(response.body.data_readiness.state, "recorded_only");
    assert.deepEqual(queries.at(-1).params.slice(0, 2), [businessId, 30]);
    assert.deepEqual(queries.at(-1).params.slice(3), [10, 0]);
  });
  it("requires authentication for every endpoint", async () => {
    for (const operation of operations) assert.equal((await request(operation.path, { ...operation, authenticated: false })).status, 401);
    assert.equal(queries.length, 0);
  });
  it("requires an owner for every endpoint", async () => {
    role = "CASHIER";
    for (const operation of operations) assert.equal((await request(operation.path, operation)).status, 403);
    assert.equal(queries.length, 0);
  });
  it("preserves the analytics plan gate for every endpoint", async () => {
    plan = "EMPRENDEDOR";
    for (const operation of operations) {
      const response = await request(operation.path, operation);
      assert.equal(response.status, 403);
      assert.equal(response.body.code, "PLAN_FEATURE_LOCKED");
    }
    assert.equal(queries.length, 0);
  });
  it("requires matching CSRF and a same-site origin on mutations", async () => {
    for (const operation of operations.filter(item => item.method)) {
      for (const extra of [{ token: "" }, { token: "wrong" }, { requestOrigin: "https://untrusted.invalid" }]) {
        assert.equal((await request(operation.path, { ...operation, ...extra })).status, 403);
      }
    }
    assert.equal(queries.length, 0);
  });
  it("strictly validates audience filters and pagination before querying", async () => {
    for (const query of ["inactive_days=7", "inactive_days=030", "inactive_days=30&inactive_days=60", "inactive_days[x]=30", "limit=0", "limit=101", "limit=1.5", "limit=01", "offset=-1", "offset=100001", "offset=0&offset=1", "business_id=other"]) {
      assert.equal((await request(`/audience?${query}`)).status, 400, query);
    }
    assert.equal(queries.length, 0);
    for (const days of [30, 60, 90]) {
      assert.equal((await request(`/audience?inactive_days=${days}&limit=100&offset=100000`)).status, 200);
      assert.deepEqual(queries.at(-1).params.slice(3), [100, 100000]);
    }
  });
  it("strictly validates run creation without trusting client tenant, dates or contact data", async () => {
    const invalid = [
      { request_id: "bad" }, { request_id: undefined }, { name: " " }, { name: "a".repeat(101) },
      { notes: "a".repeat(501) }, { notes: null }, { inactive_days: "30" }, { inactive_days: 7 },
      { limit: 0 }, { limit: 201 }, { limit: 1.5 }, { limit: "10" },
      { business_id: businessId }, { created_at: "2000-01-01" }, { customers: [customerId] }
    ];
    for (const extra of invalid) assert.equal((await request("/runs", { method: "POST", body: { ...createBody, ...extra } })).status, 400, JSON.stringify(extra));
    assert.equal(queries.length, 0);
    const response = await request("/runs", { method: "POST", body: createBody });
    assert.equal(response.status, 201);
    assert.equal(response.body.run.id, runId);
    const insert = queries.find(query => query.sql.includes("INSERT INTO recovery_runs"));
    assert.deepEqual(insert.params.slice(1, 8), [businessId, requestId, "Lista", "", 30, 50, staffId]);
    assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit_logs")));
  });
  it("validates detail IDs and paging while returning the requested summary", async () => {
    for (const path of ["/runs/invalid", `/runs/${runId}?limit=101`, `/runs/${runId}?offset=-1`, `/runs/${runId}?limit=2&limit=3`, `/runs/${runId}?business_id=other`, "/runs?limit=21"]) {
      assert.equal((await request(path)).status, 400, path);
    }
    assert.equal(queries.length, 0);
    const response = await request(`/runs/${runId}?limit=100&offset=100000`);
    assert.equal(response.status, 200);
    assert.equal(response.body.run.id, runId);
    assert.deepEqual(queries[0].params.slice(2), [runId, 100, 100000]);
    assert.equal((await request("/runs")).body.runs.length, 1);
  });
  it("requires an explicit boolean confirmation to mark contact and rejects all client timestamps", async () => {
    for (const body of [{ status: "pending" }, { status: "contacted" }, { status: "contacted", contact_confirmed: false }, { status: "contacted", contact_confirmed: "true" }, { status: "contacted", contact_confirmed: true, contacted_at: "2020-01-01" }, { status: "skipped", business_id: businessId }]) {
      assert.equal((await request(memberPath, { method: "PATCH", body })).status, 400, JSON.stringify(body));
    }
    for (const path of [`/runs/invalid/members/${customerId}`, `/runs/${runId}/members/invalid`]) {
      assert.equal((await request(path, { method: "PATCH", body: { status: "skipped" } })).status, 400);
    }
    assert.equal(queries.length, 0);
    const contacted = await request(memberPath, { method: "PATCH", body: { status: "contacted", contact_confirmed: true } });
    assert.equal(contacted.status, 200);
    assert.equal(contacted.body.member.status, "contacted");
    assert.deepEqual(queries.find(query => query.sql.includes("UPDATE recovery_members")).params, [businessId, runId, customerId, "contacted", staffId]);
    assert.equal((await request(memberPath, { method: "PATCH", body: { status: "skipped" } })).status, 200);
  });
});
