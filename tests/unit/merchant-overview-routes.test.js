import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";

import analyticsRoutes from "../../src/app/routes/analytics-routes.js";
import { pool } from "../../src/app/database.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { PlanConfigService } from "../../src/app/services/plan-config-service.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";

const businessId = randomUUID();
const staffId = randomUUID();
const branchId = randomUUID();
let role;
let plan;
let queries;
let server;
let origin;
let cookie;
const originals = { staff: StaffRepo.getById, business: BusinessRepo.getById, plans: PlanConfigService.getPlanFeatureOverrides, query: pool.query };

before(async () => {
  StaffRepo.getById = async () => ({ id: staffId, business_id: businessId, role, branch_id: null, active: true });
  BusinessRepo.getById = async () => ({ id: businessId, plan });
  PlanConfigService.getPlanFeatureOverrides = async () => ({});
  pool.query = /** @type {any} */ (async (sql, params) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM branches")) return { rows: params[0] === branchId ? [{ id: branchId }] : [] };
    return { rows: [{ start_at: "2026-11-04T06:00:00Z", end_at: "2026-11-10T18:00:00Z", previous_start_at: "2026-10-28T06:00:00Z", previous_end_at: "2026-11-03T18:00:00Z", current: {}, previous: {}, daily: [], rewards: [] }] };
  });
  const session = await createBrowserSession({ actorType: "STAFF", actorId: staffId, businessId, role: "OWNER" });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}`;
  const app = express();
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
  pool.query = originals.query;
});
async function request(query = "", authenticated = true) {
  const response = await fetch(`${origin}/api/admin/analytics/overview${query}`, { headers: authenticated ? { cookie } : {} });
  const body = await response.text();
  return { status: response.status, body: body.startsWith("{") ? JSON.parse(body) : body };
}

describe("merchant overview route through existing analytics gates", () => {
  it("requires an authenticated staff session", async () => {
    const response = await request("", false);
    assert.equal(response.status, 401);
    assert.equal(queries.length, 0);
  });
  it("rejects cashiers even with an analytics plan", async () => {
    role = "CASHIER";
    assert.equal((await request()).status, 403);
    assert.equal(queries.length, 0);
  });
  it("preserves the analytics plan gate for owners", async () => {
    plan = "EMPRENDEDOR";
    const response = await request();
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "PLAN_FEATURE_LOCKED");
    assert.equal(queries.length, 0);
  });
  it("defaults to 30 days and passes the authenticated tenant to the query", async () => {
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(response.body.scope, { branch_id: null });
    assert.deepEqual(queries.at(-1).params.slice(0, 4), [businessId, null, 30, "America/Guatemala"]);
  });
  it("accepts only the three supported periods", async () => {
    for (const days of [7, 30, 90]) {
      assert.equal((await request(`?days=${days}`)).status, 200);
      assert.equal(queries.at(-1).params[2], days);
    }
  });
  it("rejects malformed, duplicate, nested and unknown parameters before any query", async () => {
    for (const query of ["?days=0", "?days=365", "?days=7.0", "?days=07", "?days=7x", "?days=", "?days=7&days=30", "?days[x]=7", "?branch_id=invalid", "?branch_id=", `?branch_id=${branchId}&branch_id=${branchId}`, "?branch_id[x]=anything", "?business_id=anything"]) {
      assert.equal((await request(query)).status, 400, query);
    }
    assert.equal(queries.length, 0);
  });
  it("validates branch ownership with explicit tenant scoping", async () => {
    const response = await request(`?days=7&branch_id=${branchId}`);
    assert.equal(response.status, 200);
    assert.deepEqual(queries.find(q=>q.sql.includes("FROM branches")).params, [branchId, businessId]);
    assert.match(queries.find(q=>q.sql.includes("FROM branches")).sql, /business_id = \$2/);
    assert.deepEqual(queries.at(-1).params.slice(0, 3), [businessId, branchId, 7]);
    assert.equal((await request(`?branch_id=${randomUUID()}`)).status, 400);
  });
});
