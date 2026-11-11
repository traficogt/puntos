import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { pool } from "../../src/app/database.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { SecurityEventRepo } from "../../src/app/repositories/security-event-repository.js";
import { PlanConfigService } from "../../src/app/services/plan-config-service.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";

const businessId = randomUUID(), staffId = randomUUID(), segmentId = randomUUID();
const csrf = "audience-fixture-csrf", base = "/api/admin/audiences";
const definition = { window_days: 90, include: { match: "all", rules: [{ field: "has_purchase", operator: "eq", value: false }] }, exclude: { match: "any", rules: [] } };
const body = { request_id: randomUUID(), name: " Nuevos ", definition };
let server, origin, cookie, supportCookie, role, plan, calls, overrides;
const originals = { staff: StaffRepo.getById, business: BusinessRepo.getById, plans: PlanConfigService.getPlanFeatureOverrides, security: SecurityEventRepo.log, query: pool.query };
before(async () => {
  let routes; try { routes = await import("../../src/app/routes/customer-audience-routes.js"); } catch { /* asserted below */ }
  assert.equal(typeof routes?.createCustomerAudienceRouter, "function", "Audience router must exist");
  StaffRepo.getById = async () => ({ id: staffId, business_id: businessId, role, active: true });
  BusinessRepo.getById = async () => ({ id: businessId, plan });
  PlanConfigService.getPlanFeatureOverrides = async () => overrides;
  SecurityEventRepo.log = async () => {};
  pool.query = /** @type {any} */ (async () => ({ rows: [], rowCount: 0 }));
  const session = await createBrowserSession({ actorType: "STAFF", actorId: staffId, businessId, role: "OWNER" });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
  const support = await createBrowserSession({ actorType: "STAFF", actorId: staffId, businessId, role: "OWNER", impersonatedBy: "support@example.invalid" });
  supportCookie = `${config.STAFF_COOKIE_NAME}=${support.token}; pf_csrf=${csrf}`;
  const stub = name => async args => { calls.push({ name, args }); return name === "list" ? { segments: [], total: 0 } : name === "preview" ? { total: 0, contactable_count: 0, customers: [], generated_at: "2026-11-10T00:00:00Z" } : { segment: { id: segmentId } }; };
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use("/api", routes.createCustomerAudienceRouter({ listCustomerSegments: stub("list"), createCustomerSegment: stub("create"), updateCustomerSegment: stub("update"), previewCustomerAudience: stub("preview") }));
  app.use(errorHandler); server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { role = "OWNER"; plan = "NEGOCIO"; calls = []; overrides = {}; });
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  StaffRepo.getById = originals.staff; BusinessRepo.getById = originals.business;
  PlanConfigService.getPlanFeatureOverrides = originals.plans; SecurityEventRepo.log = originals.security; pool.query = originals.query;
});
async function request(path = "", options = {}) {
  const response = await fetch(`${origin}${base}${path}`, {
    method: options.method || "GET", headers: { "content-type": "application/json", cookie: options.cookie ?? cookie, origin: options.origin ?? origin, "x-csrf-token": options.csrf ?? csrf },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
}
const operations = [{ path: "" }, { path: "", method: "POST", body }, { path: "/preview", method: "POST", body: { definition } }, { path: `/${segmentId}`, method: "PUT", body: { name: "Nuevos", definition, version: 1, archived: false } }];
describe("audience API contract", () => {
  it("takes support attribution from the authenticated session only", async () => {
    for (const operation of [operations[1], operations[3]]) {
      assert.ok([200, 201].includes((await request(operation.path, { ...operation, cookie: supportCookie })).status));
      assert.equal(calls.at(-1).args.impersonated_by, "support@example.invalid");
      assert.equal((await request(operation.path, { ...operation, body: { ...operation.body, impersonated_by: "forged@example.invalid" } })).status, 400);
    }
  });
  it("requires an owner with both analytics and campaign entitlements", async () => {
    for (const operation of operations) assert.equal((await request(operation.path, { ...operation, cookie: "" })).status, 401);
    role = "CASHIER";
    for (const operation of operations) assert.equal((await request(operation.path, operation)).status, 403);
    role = "OWNER"; plan = "EMPRENDEDOR";
    for (const operation of operations) assert.equal((await request(operation.path, operation)).status, 403);
    plan = "NEGOCIO";
    for (const feature of ["analytics", "campaign_rules"]) {
      overrides = { NEGOCIO: { [feature]: false } };
      for (const operation of operations) assert.equal((await request(operation.path, operation)).status, 403);
    }
    assert.equal(calls.length, 0);
  });
  it("requires CSRF and same origin for changes and preview", async () => {
    for (const operation of operations.filter(op => op.method))
      for (const invalid of [{ csrf: "" }, { csrf: "wrong" }, { origin: "https://outside.invalid" }])
        assert.equal((await request(operation.path, { ...operation, ...invalid })).status, 403);
    assert.equal(calls.length, 0);
  });
  it("rejects client tenant selectors, unsupported rules, clocks, IDs and invalid bounds", async () => {
    for (const extra of [{ name: "" }, { name: "a".repeat(101) }, { name: "Bad\nName" }, { business_id: randomUUID() }, { archived: true }, { customer_ids: [randomUUID()] }, { definition: { ...definition, include: { match: "all", rules: [] } } }])
      assert.equal((await request("", { method: "POST", body: { ...body, ...extra } })).status, 400);
    for (const extra of [{ limit: 0 }, { limit: 21 }, { limit: "10" }, { now: "2020-01-01" }, { business_id: businessId }, { definition: { ...definition, window_days: 10 } }])
      assert.equal((await request("/preview", { method: "POST", body: { definition, ...extra } })).status, 400);
    for (const extra of [{ version: 0 }, { version: "1" }, { version: 2147483647 }, { archived: "true" }, { customer_ids: [] }])
      assert.equal((await request(`/${segmentId}`, { method: "PUT", body: { ...operations[3].body, ...extra } })).status, 400);
    for (const operation of operations) assert.equal((await request(`${operation.path}?business_id=other`, operation)).status, 400);
    assert.equal(calls.length, 0);
  });
  it("forwards normalized definitions with session scope and no-store responses", async () => {
    for (const operation of operations) {
      const result = await request(operation.path, operation);
      assert.equal(result.status, operation.method === "POST" && !operation.path ? 201 : 200);
      assert.equal(result.cache, "no-store");
      assert.equal(calls.at(-1).args.businessId, businessId);
    }
    assert.equal(calls[1].args.name, "Nuevos");
    assert.equal(calls[2].args.limit, 10);
    assert.deepEqual(calls[2].args.definition, definition);
    assert.equal(calls[3].args.segmentId, segmentId);
    assert.equal(calls[3].args.version, 1);
  });
});
