import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { createReferralGrowthRoutes } from "../../src/app/routes/referral-growth-routes.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { PlanConfigService } from "../../src/app/services/plan-config-service.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";

const businessId = randomUUID(),
  staffId = randomUUID();
let role, plan, calls, server, origin, cookie;
const originals = {
  staff: StaffRepo.getById,
  business: BusinessRepo.getById,
  plans: PlanConfigService.getPlanFeatureOverrides,
};

before(async () => {
  StaffRepo.getById = async () => ({
    id: staffId,
    business_id: businessId,
    role,
    branch_id: null,
    active: true,
  });
  BusinessRepo.getById = async () => ({ id: businessId, plan });
  PlanConfigService.getPlanFeatureOverrides = async () => ({
    NEGOCIO: { analytics: false },
  });
  const session = await createBrowserSession({
    actorType: "STAFF",
    actorId: staffId,
    businessId,
    role: "OWNER",
  });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}`;
  const app = express();
  app.use(cookieParser());
  app.use(
    "/api",
    createReferralGrowthRoutes({
      getGrowth: async (options) => {
        calls.push(options);
        return {
          ok: true,
          generated_at: "2026-11-10T18:00:00Z",
          timezone: "America/Guatemala",
          period: {
            days: options.days,
            start: "2026-10-12T06:00:00Z",
            end: "2026-11-10T18:00:00Z",
          },
          summary: {},
          referrals: [],
          pagination: {
            total: 0,
            limit: options.limit,
            offset: options.offset,
            has_more: false,
          },
          notes: [],
        };
      },
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
});
after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  StaffRepo.getById = originals.staff;
  BusinessRepo.getById = originals.business;
  PlanConfigService.getPlanFeatureOverrides = originals.plans;
});
async function request(query = "", authenticated = true) {
  const response = await fetch(`${origin}/api/admin/referral-growth${query}`, {
    headers: authenticated ? { cookie } : {},
  });
  return { status: response.status, body: await response.json() };
}

describe("referral growth owner endpoint", () => {
  it("requires authentication without querying referral data", async () => {
    assert.equal((await request("", false)).status, 401);
    assert.equal(calls.length, 0);
  });
  it("rejects cashiers and managers", async () => {
    for (role of ["CASHIER", "MANAGER"])
      assert.equal((await request()).status, 403);
    assert.equal(calls.length, 0);
  });
  it("requires the referrals plan feature", async () => {
    plan = "EMPRENDEDOR";
    const response = await request();
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "PLAN_FEATURE_LOCKED");
    assert.equal(response.body.feature, "referrals");
    assert.equal(calls.length, 0);
  });
  it("uses authenticated tenant and default query with no analytics dependency", async () => {
    assert.equal((await request()).status, 200);
    assert.deepEqual(calls, [
      { businessId, days: 30, phase: "all", limit: 25, offset: 0 },
    ]);
  });
  it("accepts supported periods, purchase filters and bounded pagination", async () => {
    assert.equal(
      (await request("?days=90&phase=awaiting_purchase&limit=100&offset=50"))
        .status,
      200,
    );
    assert.deepEqual(calls[0], {
      businessId,
      days: 90,
      phase: "awaiting_purchase",
      limit: 100,
      offset: 50,
    });
    assert.equal((await request("?phase=purchased")).status, 200);
  });
  it("rejects malformed, unknown, nested and duplicate parameters before querying", async () => {
    for (const query of [
      "?days=7",
      "?days=030",
      "?days=30&days=90",
      "?phase=rewarded",
      "?phase[x]=all",
      "?limit=0",
      "?limit=101",
      "?limit=1.5",
      "?limit=",
      "?offset=-1",
      "?offset=10001",
      "?offset=1&offset=2",
      "?business_id=someone",
      "?branch_id=anything",
    ]) {
      assert.equal((await request(query)).status, 400, query);
    }
    assert.equal(calls.length, 0);
  });
});
