/* eslint-disable security/detect-non-literal-fs-filename -- Reads repository-owned route sources only. */
process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "http://app.test";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

const rateLimit = await import("../../src/middleware/rate-limit.js");
const { checkRedisRateLimit, releaseRedisRateLimit } = await import("../../src/utils/redis-rate-limit.js");
const { matchTotpStep, totp, verifyTotp, generateBase32Secret } = await import("../../src/utils/totp.js");
const { signStaffToken, signSuperToken } = await import("../../src/utils/auth-token.js");
const { getBrowserSession } = await import("../../src/app/services/auth-session-service.js");
const { forbidImpersonatedSession, requireRecentReauth } = await import("../../src/middleware/auth.js");
const { csrfProtect } = await import("../../src/middleware/csrf.js");
const { SecurityEventRepo } = await import("../../src/app/repositories/security-event-repository.js");
const { staffRoutes } = await import("../../src/app/routes/staff-routes.js");
const { adminStaffRoutes } = await import("../../src/app/routes/admin/staff.js");
const { adminBrandingRoutes } = await import("../../src/app/routes/admin/branding-routes.js");
const { adminSignupRoutes } = await import("../../src/app/routes/admin/signup.js");
const { awardPointsWithDeps } = await import("../../src/app/services/staff-award-service.js");
const { config } = await import("../../src/config/index.js");

function routeLayer(router, path, method) {
  return router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);
}

function makeRes() {
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200,
    body: null,
    headers: {},
    set(values) { Object.assign(this.headers, values); return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  });
  return /** @type {any} */ (res);
}

/** Runs a middleware chain (arrays allowed) and finishes the response with `finalStatus` when it passes. */
async function attempt(middleware, { ip, email = undefined, finalStatus = 401 }) {
  const chain = [middleware].flat();
  const req = { ip, body: email === undefined ? {} : { email } };
  const res = makeRes();
  for (const handler of chain) {
    const error = await new Promise((resolve) => { handler(req, res, (err) => resolve(err ?? null)); });
    if (error) return error.statusCode;
  }
  res.statusCode = finalStatus;
  res.emit("finish");
  await new Promise((resolve) => setImmediate(resolve));
  return finalStatus;
}

describe("authentication rate limits", () => {
  it("keeps customer code requests from exhausting a cashier's login on the same network", async () => {
    const ip = "198.51.100.10";
    const { max } = rateLimit.AUTH_RATE_LIMITS.customerCodeRequest;
    assert.ok(max > 5, "a café network can serve more than five customer code requests");
    for (let n = 0; n < max; n += 1) assert.equal(await attempt(rateLimit.customerCodeRequestRateLimit, { ip, finalStatus: 200 }), 200);
    assert.equal(await attempt(rateLimit.customerCodeRequestRateLimit, { ip, finalStatus: 200 }), 429);
    assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: "cajero@example.test", finalStatus: 200 }), 200);
    assert.equal(await attempt(rateLimit.contactRateLimit, { ip, finalStatus: 200 }), 200);
    assert.equal(await attempt(rateLimit.passwordResetRequestRateLimit, { ip, finalStatus: 200 }), 200);
    assert.equal(await attempt(rateLimit.signupRateLimit, { ip, finalStatus: 200 }), 200);
  });

  it("limits failed logins per account and address without blocking other accounts", async () => {
    const ip = "198.51.100.20";
    const { max } = rateLimit.AUTH_RATE_LIMITS.staffLoginAccount;
    for (let n = 0; n < max; n += 1) assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: "Ana@Example.test" }), 401);
    assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: " ana@example.test " }), 429);
    assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: "luis@example.test", finalStatus: 200 }), 200);
    assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip: "198.51.100.21", email: "ana@example.test", finalStatus: 200 }), 200);
    // A different family keeps its own counters for the same account and address.
    assert.equal(await attempt(rateLimit.superLoginRateLimit, { ip, email: "ana@example.test", finalStatus: 200 }), 200);
  });

  it("does not count successful logins against the failure budget", async () => {
    const ip = "198.51.100.30";
    const { max } = rateLimit.AUTH_RATE_LIMITS.staffLoginAccount;
    for (let n = 0; n < max * 3; n += 1) {
      assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: "turno@example.test", finalStatus: 200 }), 200);
    }
    for (let n = 0; n < max; n += 1) assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: "turno@example.test" }), 401);
    assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: "turno@example.test" }), 429);
  });

  it("caps failed logins across many accounts from one address", async () => {
    const ip = "198.51.100.40";
    const { max } = rateLimit.AUTH_RATE_LIMITS.staffLoginIp;
    for (let n = 0; n < max; n += 1) assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: `cuenta-${n}@example.test` }), 401);
    assert.equal(await attempt(rateLimit.staffLoginRateLimit, { ip, email: "otra-cuenta@example.test" }), 429);
  });

  it("routes every former strict-limit caller to its own family limiter", async () => {
    const files = {
      "src/app/routes/staff-routes.js": ["staffLoginRateLimit"],
      "src/app/routes/super-routes.js": ["superLoginRateLimit", "passwordResetRequestRateLimit", "accountTokenConfirmRateLimit"],
      "src/app/routes/public-routes.js": ["customerCodeRequestRateLimit", "passwordResetRequestRateLimit", "accountTokenConfirmRateLimit", "signupRateLimit", "contactRateLimit"],
      "src/app/routes/admin/signup.js": ["signupRateLimit"],
      "src/app/routes/mobile-routes.js": ["customerCodeRequestRateLimit"]
    };
    for (const [file, limiters] of Object.entries(files)) {
      const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /\bstrictRateLimit\b/, file);
      for (const limiter of limiters) assert.match(source, new RegExp(`\\b${limiter}\\b`), `${file} uses ${limiter}`);
    }
  });
});

describe("Redis rate-limit counter", () => {
  it("increments and sets the expiry in one atomic server-side step", async () => {
    const calls = [];
    const client = {
      eval: async (script, options) => { calls.push({ script, options }); return [3, 1500]; }
    };
    const result = await checkRedisRateLimit(client, "ip:test", 2, 60000);
    assert.deepEqual(result, { allowed: false, remaining: 0, resetIn: 2 });
    assert.equal(calls.length, 1, "no separate INCR/PEXPIRE round trips");
    assert.deepEqual(calls[0].options, { keys: ["ip:test"], arguments: ["60000"] });
    assert.match(calls[0].script, /INCR/);
    assert.match(calls[0].script, /if ttl < 0 then/, "a key without expiry (-1) is repaired");
    assert.match(calls[0].script, /PEXPIRE/);
  });

  it("returns an allowance only to an existing window", async () => {
    const calls = [];
    await releaseRedisRateLimit({ eval: async (script, options) => { calls.push({ script, options }); return 0; } }, "acct:x");
    assert.equal(calls.length, 1);
    assert.match(calls[0].script, /EXISTS/);
    assert.deepEqual(calls[0].options.keys, ["acct:x"]);
  });
});

describe("TOTP replay protection", () => {
  it("returns the accepted step and refuses steps at or before the last accepted one", () => {
    const secret = generateBase32Secret();
    const nowMs = 1_800_000_000_000;
    const step = Math.floor(nowMs / 30000);
    const code = totp(secret, { nowMs });
    assert.equal(matchTotpStep(secret, code, { nowMs }), step);
    assert.equal(matchTotpStep(secret, code, { nowMs, afterStep: step - 1 }), step);
    assert.equal(matchTotpStep(secret, code, { nowMs, afterStep: step }), null);
    assert.equal(matchTotpStep(secret, code, { nowMs, afterStep: String(step + 1) }), null, "BIGINT values arrive from pg as strings");
    assert.equal(verifyTotp(secret, code, { nowMs }), true);
    assert.equal(matchTotpStep(secret, "12345", { nowMs }), null);
  });
});

describe("impersonated and link sessions", () => {
  it("never mark impersonated staff sessions as re-authenticated and default to not re-authenticated", async () => {
    const impersonated = await signStaffToken({ sid: "s-1", bid: "b-1", role: "OWNER", imp: "super@example.test", reauthVerified: true });
    assert.equal((await getBrowserSession(impersonated)).reauth_verified_at, null);
    const unspecified = await signStaffToken({ sid: "s-1", bid: "b-1", role: "OWNER" });
    assert.equal((await getBrowserSession(unspecified)).reauth_verified_at, null);
    const login = await signStaffToken({ sid: "s-1", bid: "b-1", role: "OWNER", reauthVerified: true });
    assert.ok((await getBrowserSession(login)).reauth_verified_at);
    const superDefault = await signSuperToken({ email: "super@example.test" });
    assert.equal((await getBrowserSession(superDefault)).reauth_verified_at, null);
  });

  it("refuses recent-reauth actions in impersonated sessions even with a fresh timestamp", async () => {
    const res = makeRes();
    let passed = false;
    await requireRecentReauth()({
      authSession: { id: "session-1", actor_type: "STAFF", impersonated_by: "super@example.test", reauth_verified_at: new Date().toISOString() },
      staff: { id: "s-1", impersonated_by: "super@example.test" }
    }, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "IMPERSONATION_FORBIDDEN");
  });

  it("guards every staff account-security route, including re-authentication", () => {
    for (const path of ["/staff/security/reauth", "/staff/security/mfa/enroll", "/staff/security/mfa/confirm", "/staff/security/mfa/disable", "/staff/security/email-change", "/staff/security/lockdown"]) {
      const layer = routeLayer(staffRoutes, path, "post");
      assert.ok(layer?.route.stack.some((entry) => entry.handle === forbidImpersonatedSession), path);
    }
    const res = makeRes();
    let passed = false;
    forbidImpersonatedSession({ authSession: { impersonated_by: "super@example.test" } }, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
    forbidImpersonatedSession({ authSession: { impersonated_by: null }, staff: { impersonated_by: null } }, makeRes(), () => { passed = true; });
    assert.equal(passed, true);
  });
});

describe("admin route guards", () => {
  it("requires recent re-authentication to edit staff", () => {
    const layer = routeLayer(adminStaffRoutes, "/admin/staff/:id", "patch");
    assert.ok(layer.route.stack.some((entry) => entry.handle?.__openapi?.recentReauth));
  });

  it("requires a CSRF token to change customer branding", async () => {
    const layer = routeLayer(adminBrandingRoutes, "/admin/branding", "put");
    assert.ok(layer.route.stack.some((entry) => entry.handle === csrfProtect));
    const original = SecurityEventRepo.logPrivileged;
    SecurityEventRepo.logPrivileged = async () => {};
    try {
      const res = makeRes();
      let passed = false;
      await csrfProtect({ method: "PUT", cookies: {}, headers: {}, body: {}, originalUrl: "/api/admin/branding", url: "/api/admin/branding", get: () => "app.test", protocol: "http" }, res, () => { passed = true; });
      assert.equal(passed, false);
      assert.equal(res.statusCode, 403);
    } finally {
      SecurityEventRepo.logPrivileged = original;
    }
  });

  it("compares the signup CAPTCHA secret in constant time and rejects a mismatch", async () => {
    const source = await readFile(new URL("../../src/app/routes/admin/signup.js", import.meta.url), "utf8");
    assert.match(source, /timingSafeEqualString\(providedToken, config\.SIGNUP_CAPTCHA_SECRET\)/);
    assert.doesNotMatch(source, /!==\s*config\.SIGNUP_CAPTCHA_SECRET/);
    const publicSource = await readFile(new URL("../../src/app/routes/public-routes.js", import.meta.url), "utf8");
    assert.match(publicSource, /timingSafeEqualString\(tok, config\.REGISTRATION_API_KEY\)/, "the registration key uses the same comparison");
    const original = config.SIGNUP_CAPTCHA_SECRET;
    config.SIGNUP_CAPTCHA_SECRET = "captcha-secret-0001";
    try {
      const layer = routeLayer(adminSignupRoutes, "/admin/signup", "post");
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      const res = makeRes();
      await new Promise((resolve, reject) => {
        Promise.resolve(handler({
          headers: { "x-signup-captcha": "captcha-secret-0002" },
          body: { businessName: "Café Prueba", email: "duena@example.test", password: "Volcan-Fuego-Prueba-8812" }
        }, res, (err) => (err ? reject(err) : resolve(undefined)))).then(resolve, reject);
      });
      assert.equal(res.statusCode, 403);
    } finally {
      config.SIGNUP_CAPTCHA_SECRET = original;
    }
  });
});

describe("security events without request context", () => {
  it("logs CSRF denials through the privileged writer", async () => {
    const original = { log: SecurityEventRepo.log, logPrivileged: SecurityEventRepo.logPrivileged };
    const privileged = [];
    SecurityEventRepo.log = async () => { throw new Error("plain RLS insert must not be used"); };
    SecurityEventRepo.logPrivileged = async (event) => { privileged.push(event); };
    try {
      await csrfProtect({ method: "POST", cookies: {}, headers: {}, body: {}, originalUrl: "/api/super/businesses", url: "/api/super/businesses", get: () => "app.test", protocol: "http", ip: "203.0.113.5" }, makeRes(), () => {});
      assert.equal(privileged.length, 1);
      assert.equal(privileged[0].event_type, "csrf_denied");
      assert.equal(privileged[0].actor_type, "ANON");
    } finally {
      Object.assign(SecurityEventRepo, original);
    }
  });

  it("records a blocked QR replay after the award transaction rolls back", async () => {
    const steps = [];
    const client = {
      query: async (sql) => {
        if (sql.includes("INSERT INTO security_events") || sql.includes("security_event_log")) steps.push("logged-in-transaction");
        if (sql.includes("SELECT id FROM customers")) return { rows: [{ id: "c1" }], rowCount: 1 };
        if (sql.includes("INSERT INTO qr_tokens")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }
    };
    const deps = {
      verifyQrToken: async () => ({ bid: "b1", cid: "c1", jti: "used-jti", exp: 999999 }),
      BusinessRepo: { getById: async () => ({ id: "b1", plan: "EMPRESA", program_type: "SPEND", program_json: {} }), activeCustomerCount: async () => 0 },
      computePoints: () => 5,
      planLimits: () => ({ activeCustomers: 1000 }),
      withTransaction: async (fn) => {
        steps.push("begin");
        try { const out = await fn(client); steps.push("commit"); return out; } catch (error) { steps.push("rollback"); throw error; }
      },
      enqueueWebhookEvent: async () => {}
    };
    const args = { staff: { id: "s1", business_id: "b1", branch_id: null, role: "CASHIER", impersonated_by: null }, customerQrToken: "qr", amount_q: 10 };

    const original = SecurityEventRepo.logPrivileged;
    SecurityEventRepo.logPrivileged = async (event) => { steps.push(`logged:${event.event_type}:${event.business_id}`); };
    try {
      await assert.rejects(awardPointsWithDeps(deps, args), { statusCode: 409 });
    } finally {
      SecurityEventRepo.logPrivileged = original;
    }
    assert.deepEqual(steps, ["begin", "rollback", "logged:qr_replay_blocked:b1"]);

    const injected = [];
    steps.length = 0;
    await assert.rejects(awardPointsWithDeps({ ...deps, logSecurityEvent: async (event) => { injected.push(event); } }, args), { statusCode: 409 });
    assert.deepEqual(steps, ["begin", "rollback"]);
    assert.equal(injected[0].event_type, "qr_replay_blocked");
    assert.equal(injected[0].meta.jti, "used-jti");
  });
});
