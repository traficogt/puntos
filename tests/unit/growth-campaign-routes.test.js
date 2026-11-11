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

const businessId = randomUUID(),
  staffId = randomUUID(),
  customerId = randomUUID(),
  campaignId = randomUUID();
const csrf = "growth-csrf-token",
  base = "/api/admin/growth-campaigns";
let server, origin, staffCookie, customerCookie, supportCookie, role, plan, calls, overrides;
const originals = {
  staff: StaffRepo.getById,
  business: BusinessRepo.getById,
  plans: PlanConfigService.getPlanFeatureOverrides,
  security: SecurityEventRepo.log,
  query: pool.query,
};
before(async () => {
  let routes;
  try {
    routes = await import("../../src/app/routes/growth-campaign-routes.js");
  } catch {
    /* asserted below */
  }
  assert.equal(
    typeof routes?.createGrowthCampaignRouter,
    "function",
    "Growth campaign router must exist",
  );
  StaffRepo.getById = async () => ({
    id: staffId,
    business_id: businessId,
    role,
    active: true,
  });
  BusinessRepo.getById = async () => ({ id: businessId, plan });
  PlanConfigService.getPlanFeatureOverrides = async () => overrides;
  SecurityEventRepo.log = async () => {};
  pool.query = /** @type {any} */ (async () => ({ rows: [], rowCount: 0 }));
  const staffSession = await createBrowserSession({
    actorType: "STAFF",
    actorId: staffId,
    businessId,
    role: "OWNER",
  });
  const customerSession = await createBrowserSession({
    actorType: "CUSTOMER",
    actorId: customerId,
    businessId,
  });
  staffCookie = `${config.STAFF_COOKIE_NAME}=${staffSession.token}; pf_csrf=${csrf}`;
  const support = await createBrowserSession({ actorType: "STAFF", actorId: staffId, businessId, role: "OWNER", impersonatedBy: "support@example.invalid" });
  supportCookie = `${config.STAFF_COOKIE_NAME}=${support.token}; pf_csrf=${csrf}`;
  customerCookie = `${config.CUSTOMER_COOKIE_NAME}=${customerSession.token}; pf_csrf=${csrf}`;
  const stub = (name) => async (args) => {
    calls.push({ name, args });
    return name === "list"
      ? { campaigns: [], total: 0, limit: args.limit, offset: args.offset }
      : name === "offers"
        ? { offers: [] }
        : { campaign: { id: campaignId, status: "draft" } };
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    "/api",
    routes.createGrowthCampaignRouter({
      listGrowthCampaigns: stub("list"),
      createGrowthCampaign: stub("create"),
      getGrowthCampaign: stub("get"),
      activateGrowthCampaign: stub("activate"),
      pauseGrowthCampaign: stub("pause"),
      createCampaignPreflight: stub("preflight"),
      createCampaignPreparation: stub("prepare"),
      retryCampaignPreparation: stub("retry"),
      cancelCampaignPreparation: stub("cancel"),
    }),
  );
  app.use(
    "/api",
    routes.createCustomerGrowthOffersRouter({
      getCustomerGrowthOffers: stub("offers"),
    }),
  );
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  role = "OWNER";
  plan = "NEGOCIO";
  calls = [];
  overrides = {};
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  StaffRepo.getById = originals.staff;
  BusinessRepo.getById = originals.business;
  PlanConfigService.getPlanFeatureOverrides = originals.plans;
  SecurityEventRepo.log = originals.security;
  pool.query = originals.query;
});
const body = {
  request_id: randomUUID(),
  recovery_run_id: randomUUID(),
  name: " Volver ",
  bonus_points: 50,
  minimum_purchase_q: 20,
  duration_days: 14,
};
async function request(
  path = "",
  {
    method = "GET",
    body: payload = undefined,
    cookie = staffCookie,
    token = csrf,
    requestOrigin = origin,
    customer = false,
  } = {},
) {
  const headers = { "content-type": "application/json", origin: requestOrigin };
  if (cookie) headers.cookie = cookie;
  if (token) headers["x-csrf-token"] = token;
  const response = await fetch(
    `${origin}${customer ? "/api/customer/growth-offers" : base}${path}`,
    {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    },
  );
  return {
    status: response.status,
    body: await response.json(),
    cache: response.headers.get("cache-control"),
  };
}
const operations = [
  { path: "" },
  { path: `/${campaignId}` },
  { path: "", method: "POST", body },
  { path: `/${campaignId}/activate`, method: "POST", body: {} },
  { path: `/${campaignId}/pause`, method: "POST", body: {} },
];
describe("growth API boundaries", () => {
  it("forwards support attribution from the session for campaign mutations", async () => {
    for (const operation of operations.filter(op => op.method)) {
      assert.ok([200, 201].includes((await request(operation.path, { ...operation, cookie: supportCookie })).status));
      assert.equal(calls.at(-1).args.impersonated_by, "support@example.invalid");
      assert.equal((await request(operation.path, { ...operation, body: { ...operation.body, impersonated_by: "forged@example.invalid" } })).status, 400);
    }
  });
  it("accepts an explicit saved audience version and bounded snapshot limit instead of recovery", async () => {
    const { recovery_run_id, ...rest } = body;
    const audience = { ...rest, audience_segment_id: randomUUID(), audience_segment_version: 2, audience_limit: 100 };
    assert.equal((await request("", { method: "POST", body: audience })).status, 201);
    assert.equal(calls[0].args.audienceSegmentId, audience.audience_segment_id);
    assert.equal(calls[0].args.audienceSegmentVersion, 2);
    assert.equal(calls[0].args.audienceLimit, 100);
    assert.equal(calls[0].args.recoveryRunId, undefined);
    for (const patch of [{ recovery_run_id }, { audience_limit: undefined }, { audience_segment_version: undefined }, { audience_limit: 201 }, { audience_limit: 9 }, { audience_segment_version: "2" }, { audience_segment_version: 0 }, { audience_snapshot: {} }])
      assert.equal((await request("", { method: "POST", body: { ...audience, ...patch } })).status, 400);
    assert.equal((await request("", { method: "POST", body: rest })).status, 400);
    assert.equal((await request("", { method: "POST", body: { ...body, audience_limit: 20 } })).status, 400);
  });
  it("requires authenticated owner and both campaign and analytics entitlements for every owner endpoint", async () => {
    for (const op of operations)
      assert.equal((await request(op.path, { ...op, cookie: "" })).status, 401);
    role = "CASHIER";
    for (const op of operations)
      assert.equal((await request(op.path, op)).status, 403);
    role = "OWNER";
    plan = "EMPRENDEDOR";
    for (const op of operations)
      assert.equal((await request(op.path, op)).status, 403);
    plan = "NEGOCIO";
    for (const feature of ["campaign_rules", "analytics"]) {
      overrides = { NEGOCIO: { [feature]: false } };
      for (const op of operations)
        assert.equal((await request(op.path, op)).status, 403);
    }
    assert.equal(calls.length, 0);
  });
  it("enforces CSRF and same origin for every mutation", async () => {
    for (const op of operations.filter((op) => op.method))
      for (const extra of [
        { token: "" },
        { token: "wrong" },
        { requestOrigin: "https://outside.invalid" },
      ])
        assert.equal((await request(op.path, { ...op, ...extra })).status, 403);
    assert.equal(calls.length, 0);
  });
  it("strictly validates terms and refuses tenant, timestamps, allocations, query values and coercion", async () => {
    for (const extra of [
      { request_id: "bad" },
      { name: "" },
      { name: "a".repeat(101) },
      { bonus_points: 0 },
      { bonus_points: 10001 },
      { bonus_points: "10" },
      { bonus_points: 1.5 },
      { points_budget: 0 },
      { points_budget: 49 },
      { points_budget: 2000001 },
      { points_budget: "100" },
      { points_budget: 50.5 },
      { points_committed: 0 },
      { minimum_purchase_q: -1 },
      { minimum_purchase_q: 1.001 },
      { duration_days: 15 },
      { holdout_percent: 50 },
      { estimated_cost_per_point_q: 101 },
      { estimated_cost_per_point_q: -1 },
      { business_id: businessId },
      { starts_at: "2020-01-01" },
      { allocation: "treatment" },
      { status: "active" },
    ])
      assert.equal(
        (await request("", { method: "POST", body: { ...body, ...extra } }))
          .status,
        400,
        JSON.stringify(extra),
      );
    for (const path of [
      "?business_id=other",
      "/invalid",
      `/${campaignId}?now=2000`,
    ])
      assert.equal((await request(path)).status, 400);
    for (const action of ["activate", "pause"])
      assert.equal(
        (
          await request(`/${campaignId}/${action}`, {
            method: "POST",
            body: { starts_at: "2000" },
          })
        ).status,
        400,
      );
    assert.equal(calls.length, 0);
  });
  it("uses the session tenant, normalized draft values and no-store responses", async () => {
    const result = await request("", { method: "POST", body });
    assert.equal(result.status, 201);
    assert.equal(result.cache, "no-store");
    assert.equal(calls[0].args.businessId, businessId);
    assert.equal(calls[0].args.name, "Volver");
    assert.equal(calls[0].args.holdoutPercent, 20);
    assert.equal(calls[0].args.pointsBudget, null);
    assert.equal(calls[0].args.estimatedCostPerPointQ, null);
    for (const op of operations.filter((op) => op.method !== "POST"))
      assert.equal((await request(op.path)).status, 200);
  });
  it("accepts nullable bounded total point budgets and forwards them without coercion", async () => {
    for (const points_budget of [null, 50, 2000000]) {
      assert.equal((await request("", {method: "POST", body: {...body, points_budget}})).status, 201);
      assert.equal(calls.at(-1).args.pointsBudget, points_budget);
    }
    for (const action of ["activate", "pause"]) {
      assert.equal((await request(`/${campaignId}/${action}`, {method:"POST",body:{points_budget:100}})).status,400);
    }
  });
  it("strictly bounds pagination and preserves the default list path", async () => {
    for (const query of ["limit=0", "limit=51", "limit=1.5", "limit=01", "limit=-1", "limit=", "limit=20&limit=10", "limit[x]=20", "offset=-1", "offset=100001", "offset=0.5", "offset=01", "offset=", "offset=0&offset=20", "offset[x]=1", "business_id=other"]) {
      assert.equal((await request(`?${query}`)).status, 400, query);
    }
    assert.equal(calls.length, 0);
    const first = await request();
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { campaigns: [], total: 0, limit: 20, offset: 0 });
    assert.deepEqual(calls[0], { name: "list", args: { businessId, limit: 20, offset: 0 } });
    const second = await request("?limit=50&offset=100000");
    assert.equal(second.status, 200);
    assert.equal(second.cache, "no-store");
    assert.deepEqual(calls[1], { name: "list", args: { businessId, limit: 50, offset: 100000 } });
    assert.equal((await request(`/${campaignId}?limit=20`)).status, 400);
    assert.equal((await request("?offset=0", { method: "POST", body })).status, 400);
  });
  it("requires customer authentication and never accepts a customer or tenant selector", async () => {
    assert.equal((await request("", { customer: true })).status, 401);
    assert.equal(
      (
        await request("?customer_id=other", {
          customer: true,
          cookie: customerCookie,
        })
      ).status,
      400,
    );
    const result = await request("", {
      customer: true,
      cookie: customerCookie,
    });
    assert.equal(result.status, 200);
    assert.equal(result.cache, "no-store");
    assert.deepEqual(calls, [
      { name: "offers", args: { businessId, customerId } },
    ]);
  });
});

describe("campaign expansion boundaries", () => {
  it("accepts owner-reviewed quiet offers with short validity and mandatory cap", async () => {
    const quiet = { request_id: randomUUID(), name: "Quiet", audience_segment_id: randomUUID(), audience_segment_version: 1, audience_limit: 25, bonus_points: 50, points_budget: 100, minimum_purchase_q: 10, duration_minutes: 60 };
    assert.equal((await request("/quiet", { method: "POST", body: quiet })).status, 201);
    assert.equal(calls.at(-1).args.offerKind,"quiet"); assert.equal(calls.at(-1).args.holdoutPercent,0);
    for(const patch of [{duration_minutes:29},{duration_minutes:241},{points_budget:null},{audience_limit:201},{holdout_percent:20},{duration_days:7}]) assert.equal((await request("/quiet",{method:"POST",body:{...quiet,...patch}})).status,400);
    role="CASHIER"; assert.equal((await request("/quiet",{method:"POST",body:quiet})).status,403);
  });
  it("keeps the 200-person synchronous contract and offers a bounded explicit preparation endpoint", async()=>{
    const payload={...body,recovery_run_id:undefined,audience_segment_id:randomUUID(),audience_segment_version:1,audience_limit:5000};
    assert.equal((await request("/prepare",{method:"POST",body:payload})).status,202);
    assert.equal(calls.at(-1).name,"prepare"); assert.equal(calls.at(-1).args.audienceLimit,5000);
    assert.equal((await request("",{method:"POST",body:payload})).status,400);
    assert.equal((await request("/prepare",{method:"POST",body:{...payload,audience_limit:5001}})).status,400);
    assert.equal((await request("/prepare",{method:"POST",body:payload,token:""})).status,403);
  });
  it("provides CSRF-protected preflight and cancellation, accepts only the preview identity on activation",async()=>{
    for(const [action,name] of [["preflight","preflight"],["preparation/cancel","cancel"],["preparation/retry","retry"]]){
      assert.equal((await request(`/${campaignId}/${action}`,{method:"POST",body:{}})).status,200); assert.equal(calls.at(-1).name,name);
      assert.equal((await request(`/${campaignId}/${action}`,{method:"POST",body:{},token:""})).status,403);
    }
    const id=randomUUID(); assert.equal((await request(`/${campaignId}/activate`,{method:"POST",body:{preflight_id:id}})).status,200);
    assert.equal(calls.at(-1).args.preflightId,id);
    assert.equal((await request(`/${campaignId}/activate`,{method:"POST",body:{preflight_id:"forged"}})).status,400);
  });
});
