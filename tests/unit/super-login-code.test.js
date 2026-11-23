import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import express from "express";
import { superRoutes } from "../../src/app/routes/super-routes.js";
import { SuperAdminAuthRepo } from "../../src/app/repositories/super-admin-auth-repository.js";
import { SecurityEventRepo } from "../../src/app/repositories/security-event-repository.js";
import { inferErrorCode } from "../../src/utils/http-error.js";

// Super login answers a failed credential check inline (res.status(401).json(...)), so the
// error middleware never infers a code for it. The route now sends the code the middleware
// would have derived for that message and status, so installed clients see the same value.
const original = { getEffective: SuperAdminAuthRepo.getEffective, log: SecurityEventRepo.log };
let server, origin;
const events = [];

before(async () => {
  SuperAdminAuthRepo.getEffective = async () => ({
    email: "super@example.com",
    // Not an argon2 or bcrypt hash: verifyPassword returns false without touching a hasher.
    password_hash: "fixture-hash-that-never-matches",
    mfa_enabled: false,
  });
  SecurityEventRepo.log = async (event) => {
    events.push(event);
  };
  const app = express();
  app.use(express.json());
  app.use("/api", superRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  SuperAdminAuthRepo.getEffective = original.getEffective;
  SecurityEventRepo.log = original.log;
  await new Promise((resolve) => server.close(resolve));
});

test("super login rejection carries the code inference would have produced", async () => {
  const response = await fetch(`${origin}/api/super/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "super@example.com", password: "wrong-password-123" }),
  });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error, "Credenciales inválidas");
  assert.equal(body.code, inferErrorCode(body.error, response.status));
  assert.equal(body.code, "AUTH_REQUIRED");
  assert.equal(events.at(-1)?.event_type, "super_login_failed");
});
