import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

const tierRoutes = (await import("../../src/app/routes/tier-routes.js")).default;
const { gamificationAdminRoutes } =
  await import("../../src/app/routes/gamification-admin-routes.js");
const { analyticsJobRoutes } = await import("../../src/app/routes/analytics/jobs.js");
const { analyticsCorrectionRoutes } = await import("../../src/app/routes/analytics/corrections.js");
const { analyticsSegmentRoutes } = await import("../../src/app/routes/analytics/segments.js");
const { adminRewardsRoutes } = await import("../../src/app/routes/admin/rewards.js");
const { adminStaffRoutes } = await import("../../src/app/routes/admin/staff.js");
const { superMagicLinkRoutes } = await import("../../src/app/routes/super-magic-link-routes.js");
const { paymentWebhookRoutes } = await import("../../src/app/routes/payment-webhook-routes.js");

const UUID = "11111111-1111-4111-8111-111111111111";

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

function validationLayer(router, routePath, method, name) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route?.methods?.[method],
  );
  assert.ok(layer, `Expected ${method.toUpperCase()} ${routePath}`);
  const step = layer.route.stack.find((entry) => entry.name === name);
  assert.ok(step, `Expected a ${name} layer on ${method.toUpperCase()} ${routePath}`);
  return step.handle;
}

function run(middleware, req) {
  const res = /** @type {any} */ (makeRes());
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

/** @type {Array<[import("express").Router, string, string, string]>} */
const uuidParamRoutes = [
  [tierRoutes, "/admin/tiers/:id", "put", "id"],
  [tierRoutes, "/admin/tiers/:id", "delete", "id"],
  [gamificationAdminRoutes, "/admin/achievements/:id", "put", "id"],
  [gamificationAdminRoutes, "/admin/achievements/:id", "delete", "id"],
  [gamificationAdminRoutes, "/admin/challenges/:id", "put", "id"],
  [gamificationAdminRoutes, "/admin/challenges/:id", "delete", "id"],
  [analyticsJobRoutes, "/admin/jobs/:id", "get", "id"],
  [analyticsCorrectionRoutes, "/admin/analytics/ledger-corrections/:id/apply", "post", "id"],
  [analyticsCorrectionRoutes, "/admin/analytics/ledger-corrections/:id/reject", "post", "id"],
  [analyticsSegmentRoutes, "/admin/analytics/segments/:id", "get", "id"],
  [adminRewardsRoutes, "/admin/rewards/:id", "patch", "id"],
  [adminStaffRoutes, "/admin/staff/:id", "patch", "id"],
  [superMagicLinkRoutes, "/super/businesses/:businessId/staff", "get", "businessId"],
  [superMagicLinkRoutes, "/super/businesses/:businessId/customers", "get", "businessId"],
  [paymentWebhookRoutes, "/admin/payment-webhooks/:id/resolve", "post", "id"],
];

describe("route parameter validation", () => {
  for (const [router, routePath, method, param] of uuidParamRoutes) {
    it(`${method.toUpperCase()} ${routePath} answers 400 VALIDATION_ERROR for a malformed ${param}`, () => {
      const middleware = validationLayer(router, routePath, method, "validateParams");
      const invalid = run(middleware, { params: { [param]: "not-a-uuid" } });
      assert.equal(invalid.nextCalled, false);
      assert.equal(invalid.res.statusCode, 400);
      assert.equal(invalid.res.body.code, "VALIDATION_ERROR");
      assert.equal(invalid.res.body.error, "Parámetros de ruta inválidos");
      assert.deepEqual(
        invalid.res.body.details.map((detail) => detail.field),
        [param],
      );
      const req = /** @type {any} */ ({ params: { [param]: UUID } });
      const valid = run(middleware, req);
      assert.equal(valid.nextCalled, true);
      assert.equal(valid.res.body, null);
      assert.equal(req.validatedParams[param], UUID);
    });
  }

  it("payment webhooks validate only the provider name before handing off to signature checks", () => {
    const middleware = validationLayer(
      paymentWebhookRoutes,
      "/public/payments/webhook/:provider",
      "post",
      "validateParams",
    );
    const blank = run(middleware, { params: { provider: "   " } });
    assert.equal(blank.nextCalled, false);
    assert.equal(blank.res.statusCode, 400);
    assert.equal(blank.res.body.details[0].field, "provider");
    const req = /** @type {any} */ ({ params: { provider: " Cubo " }, body: { anything: "goes" } });
    const valid = run(middleware, req);
    assert.equal(valid.nextCalled, true);
    assert.equal(req.validatedParams.provider, "Cubo");
    // No body schema runs before the service verifies the signature.
    const layer = paymentWebhookRoutes.stack.find(
      (entry) => entry.route?.path === "/public/payments/webhook/:provider",
    );
    assert.equal(
      layer.route.stack.some((entry) => entry.name === "validateRequest"),
      false,
    );
  });

  it("ledger correction listing rejects only non-numeric limits and keeps numeric clamping", () => {
    const middleware = validationLayer(
      analyticsCorrectionRoutes,
      "/admin/analytics/ledger-corrections",
      "get",
      "validateQuery",
    );
    const invalid = run(middleware, { query: { limit: "abc" } });
    assert.equal(invalid.nextCalled, false);
    assert.equal(invalid.res.statusCode, 400);
    assert.equal(invalid.res.body.code, "VALIDATION_ERROR");
    assert.equal(invalid.res.body.error, "Parámetros de consulta inválidos");
    assert.equal(invalid.res.body.details[0].field, "limit");
    for (const [limit, expected] of [
      ["500", 500],
      ["0", 0],
      ["", 0],
      [undefined, undefined],
    ]) {
      const req = /** @type {any} */ ({ query: limit === undefined ? {} : { limit } });
      const valid = run(middleware, req);
      assert.equal(valid.nextCalled, true, `limit=${limit}`);
      assert.equal(req.validatedQuery.limit, expected);
    }
  });
});
