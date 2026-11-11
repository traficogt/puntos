import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config/index.js";
import { publicRoutes } from "../../src/app/routes/public-routes.js";
import { AuthSessionRepo } from "../../src/app/repositories/auth-session-repository.js";
import { superRoutes } from "../../src/app/routes/super-routes.js";

for (const [router, path] of [[publicRoutes, "/public/customer/logout"], [superRoutes, "/super/logout"]]) {
test(`${path} reports session revocation failure instead of clearing the cookie and claiming success`, async t => {
  const previousMode = config.NODE_ENV;
  config.NODE_ENV = "development";
  t.after(() => { config.NODE_ENV = previousMode; });
  const failure = new Error("sandbox revocation unavailable");
  t.mock.method(AuthSessionRepo, "invalidateById", async () => { throw failure; });
  const route = /** @type {import("express").Router} */ (router).stack.find(layer => layer.route?.path === path);
  const handler = /** @type {any} */ (route.route.stack.at(-1).handle);
  const writes = [];
  let receivedError;
  await handler({ authSession: { id: "sandbox-session" } }, {
    clearCookie: (...args) => writes.push(args), json: payload => writes.push(payload)
  }, error => { receivedError = error; });
  assert.equal(receivedError, failure);
  assert.deepEqual(writes, []);
});
}
