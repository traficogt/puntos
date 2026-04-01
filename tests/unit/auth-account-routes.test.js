import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { publicRoutes } from "../../src/app/routes/public-routes.js";
import { staffRoutes } from "../../src/app/routes/staff-routes.js";
import { superRoutes } from "../../src/app/routes/super-routes.js";

function routeLayer(router, path, method) {
  return router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);
}

function assertRoute(router, path, method) {
  const layer = routeLayer(router, path, method);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path}`);
  return layer;
}

describe("account security routes", () => {
  it("exposes public reset and email-confirm routes as POST endpoints", () => {
    assertRoute(publicRoutes, "/public/staff/password-reset/request", "post");
    assertRoute(publicRoutes, "/public/staff/password-reset/confirm", "post");
    assertRoute(publicRoutes, "/public/staff/email-change/confirm", "post");
    assertRoute(superRoutes, "/public/super/password-reset/request", "post");
    assertRoute(superRoutes, "/public/super/password-reset/confirm", "post");
    assertRoute(superRoutes, "/public/super/email-change/confirm", "post");
  });

  it("marks sensitive staff and super routes with recent-reauth middleware", () => {
    const staffSensitive = [
      "/staff/security/mfa/enroll",
      "/staff/security/mfa/confirm",
      "/staff/security/mfa/disable",
      "/staff/security/email-change",
      "/staff/security/lockdown"
    ];
    for (const path of staffSensitive) {
      const layer = assertRoute(staffRoutes, path, "post");
      assert.ok(layer.route.stack.some((entry) => entry.handle?.__openapi?.recentReauth), `${path} should require recent reauth`);
    }

    const superSensitive = [
      "/super/security/mfa/enroll",
      "/super/security/mfa/confirm",
      "/super/security/mfa/disable",
      "/super/security/email-change",
      "/super/security/lockdown",
      "/super/security/rotate-secrets"
    ];
    for (const path of superSensitive) {
      const layer = assertRoute(superRoutes, path, "post");
      assert.ok(layer.route.stack.some((entry) => entry.handle?.__openapi?.recentReauth), `${path} should require recent reauth`);
    }
  });
});
