import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
process.env.NODE_ENV = "test";
const { BusinessRepo } = await import("../../src/app/repositories/business-repository.js");
const { PlanConfigService } = await import("../../src/app/services/plan-config-service.js");
const { SecurityEventRepo } = await import("../../src/app/repositories/security-event-repository.js");
const { requireStaff, requireOwner } = await import("../../src/middleware/auth.js");
const { tenantContext } = await import("../../src/middleware/tenant.js");
const { csrfProtect } = await import("../../src/middleware/csrf.js");
const { errorHandler } = await import("../../src/middleware/common.js");

test("preflight wires the staff, owner, tenant, plan and CSRF guards", async () => {
  const { posOnboardingRoutes } = await import("../../src/app/routes/admin/pos-onboarding-routes.js");
  const route = posOnboardingRoutes.stack.find(layer => layer.route?.path === "/admin/pos/preflight").route;
  const handlers = route.stack.map(entry => /** @type {typeof entry.handle & { __openapi?: { planFeatures?: string[], csrfRequired?: boolean } }} */ (entry.handle));
  assert.deepEqual(handlers.slice(0, 3), [requireStaff, requireOwner, tenantContext]);
  assert.ok(handlers.some(handler => handler.__openapi?.planFeatures?.includes("external_awards")));
  assert.ok(handlers.includes(csrfProtect));
});

test("only an authorized owner can preflight the session business", async t => {
  const { createPosOnboardingRoutes } = await import("../../src/app/routes/admin/pos-onboarding-routes.js");
  let role = "OWNER", plan = "EMPRESA", authenticated = true, featureOverrides = {};
  const calls = [];
  t.mock.method(BusinessRepo, "getById", async id => ({ id, plan }));
  t.mock.method(PlanConfigService, "getPlanFeatureOverrides", async () => featureOverrides);
  t.mock.method(SecurityEventRepo, "log", async () => {});
  const router = createPosOnboardingRoutes({
    requireStaff(req, res, next) {
      if (!authenticated) return res.status(401).json({ error: "Authentication required" });
      req.staff = { id: "owner", business_id: "session-business", role }; next();
    },
    previewPosSale: async (id, body) => { calls.push({ id, body }); return { ok: true, dryRun: true }; }
  });
  const app = express();
  app.use(express.json()); app.use(cookieParser()); app.use("/api", router); app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  async function request({ csrf = true } = {}) {
    const response = await fetch(`${origin}/api/admin/pos/preflight`, { method: "POST", headers: {
      "Content-Type": "application/json", origin,
      ...(csrf ? { cookie: "pf_csrf=test", "x-csrf-token": "test" } : {})
    }, body: JSON.stringify({ saleId: "sample", businessId: "untrusted-business" }) });
    return { status: response.status, body: await response.json() };
  }
  try {
    authenticated = false; assert.equal((await request()).status, 401);
    authenticated = true; role = "CASHIER"; assert.equal((await request()).status, 403);
    role = "MANAGER"; assert.equal((await request()).status, 403);
    role = "OWNER"; plan = "NEGOCIO"; assert.equal((await request()).body.code, "PLAN_FEATURE_LOCKED");
    plan = "EMPRESA"; assert.equal((await request({ csrf: false })).status, 403);
    assert.deepEqual(calls, []);
    plan = "NEGOCIO"; featureOverrides = { NEGOCIO: { external_awards: true } };
    assert.equal((await request()).status, 200);
    assert.equal(calls.length, 1); assert.equal(calls[0].id, "session-business");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
