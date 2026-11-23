import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { createPosCheckoutRoutes } from "../../src/app/routes/pos-checkout-routes.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { SecurityEventRepo } from "../../src/app/repositories/security-event-repository.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";

const businessId = randomUUID(),
  staffId = randomUUID(),
  csrf = "fixture-pos-checkout-csrf";
const source = {
  source: "odoo:fixture:1",
  branchId: null,
  staffId: randomUUID(),
  enabled: true,
  version: 0,
};
let server, origin, cookie, calls;
const original = { staff: StaffRepo.getById, security: SecurityEventRepo.log };
before(async () => {
  StaffRepo.getById = async () => ({
    id: staffId,
    business_id: businessId,
    role: "OWNER",
    active: true,
  });
  SecurityEventRepo.log = async () => {};
  const session = await createBrowserSession({
    actorType: "STAFF",
    actorId: staffId,
    businessId,
    role: "OWNER",
  });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(
    "/api",
    createPosCheckoutRoutes({
      getCheckoutSources: async (input) => {
        calls.push({ kind: "list", input });
        return { ok: true, sources: [] };
      },
      configureCheckoutSource: async (input) => {
        calls.push({ kind: "save", input });
        return { ok: true };
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
  calls = [];
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  StaffRepo.getById = original.staff;
  SecurityEventRepo.log = original.security;
});
async function put(body, path = "/api/admin/pos-checkout/sources") {
  const response = await fetch(origin + path, {
    method: "PUT",
    headers: { cookie, origin, "x-csrf-token": csrf, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
test("checkout source configuration rejects a malformed envelope with field details before the service runs", async () => {
  const out = await put({ ...source, enabled: "yes", version: "0", staffId: undefined });
  assert.equal(out.status, 400);
  assert.equal(out.body.code, "VALIDATION_ERROR");
  assert.equal(out.body.error, "Revisa los datos enviados.");
  assert.deepEqual(out.body.details.map((detail) => detail.field).sort(), [
    "enabled",
    "staffId",
    "version",
  ]);
  assert.equal(calls.length, 0);
});
test("a well-formed envelope reaches the service unchanged, including keys left to its strict schema", async () => {
  const body = { ...source, businessId: randomUUID() };
  const out = await put(body);
  assert.equal(out.status, 200);
  assert.deepEqual(calls, [
    { kind: "save", input: { businessId, staff: calls[0].input.staff, input: body } },
  ]);
  assert.equal(calls[0].input.staff.id, staffId);
});
test("query filters are still refused for well-formed envelopes", async () => {
  const out = await put(source, "/api/admin/pos-checkout/sources?businessId=" + randomUUID());
  assert.equal(out.status, 400);
  assert.equal(out.body.error, "No se admiten filtros.");
  assert.equal(calls.length, 0);
});
