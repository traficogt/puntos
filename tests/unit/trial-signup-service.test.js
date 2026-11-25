import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { runWithDbContext } from "../../src/app/database.js";
import {
  assertAllowedDialCode,
  createTrialSignupService,
  trialSignupAvailable,
} from "../../src/app/services/trial-signup-service.js";
import { hashSessionToken } from "../../src/app/services/auth-session-service.js";

const phone = "50255551234";
const hash = await bcrypt.hash("123456", 4);
const now = new Date("2026-11-25T21:00:00.000Z");
const ownerId = "33333333-3333-4333-8333-333333333333";
const branchId = "44444444-4444-4444-8444-444444444444";

function fixture(overrides = {}) {
  const state = {
    messages: [],
    codes: [],
    failed: 0,
    consumed: false,
    grants: new Map(),
    phonesWithTrial: new Set(),
    issuedToday: 0,
    turnstile: true,
    created: [],
    billingEvents: [],
    emails: [],
    markers: [],
    steps: [],
    existingEmails: new Set(),
    createError: null,
  };
  const business = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "cafe-prueba",
    name: "Café Prueba",
    email: "owner@example.com",
    plan: "EMPRENDEDOR",
    program_json: {},
    trial_status: "active",
    billing_status: "trialing",
    trial_started_at: now,
    trial_ends_at: new Date(now.getTime() + 14 * 86_400_000),
    billing_currency: null,
  };
  const deps = {
    accessRepo: {
      lockPhone: async () => {},
      requestCounts: async () => ({ minute: 0, hour: 0 }),
      createCode: async (value) => {
        state.codes.push(value);
      },
      invalidateCode: async () => {
        state.consumed = true;
      },
      latestCode: async () =>
        state.consumed || state.failed >= 5 ? null : { id: "code-a", code_hash: hash },
      failCode: async () => {
        state.failed++;
      },
      consumeCode: async () => {
        state.consumed = true;
        return true;
      },
    },
    repo: {
      createGrant: async (grant) => {
        state.grants.set(grant.token_hash, { ...grant, consumed: false });
      },
      lockGrant: async (tokenHash) => {
        const grant = state.grants.get(tokenHash);
        return grant && !grant.consumed && grant.expires_at > now
          ? { id: grant.id, phone: grant.phone }
          : null;
      },
      consumeGrant: async (id) => {
        const grant = [...state.grants.values()].find((g) => g.id === id);
        if (!grant || grant.consumed) return false;
        grant.consumed = true;
        return true;
      },
      restoreGrant: async (id) => {
        const grant = [...state.grants.values()].find((g) => g.id === id);
        if (grant) grant.consumed = false;
      },
      phoneHasTrial: async (value) => state.phonesWithTrial.has(value),
      countPhoneCodesToday: async () => state.issuedToday,
      markNotified: async (marker) => {
        state.markers.push(marker);
        return true;
      },
    },
    runWithDbContext,
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    withDbClientContext: async (_ctx, fn) => fn(),
    sendMessage: async (message) => {
      state.messages.push(message);
      return { ok: true };
    },
    verifyTurnstile: async () => state.turnstile,
    createBusinessWithOwner: async (input) => {
      state.created.push(input);
      if (state.createError) throw state.createError;
      return /** @type {any} */ ({ business, ownerId, branchId });
    },
    getBusinessByEmail: async (email) => (state.existingEmails.has(email) ? { id: "x" } : null),
    sendTrialEmail: async (message) => {
      state.emails.push(message);
      return { ok: true, providerId: "smtp:1" };
    },
    emailReady: () => true,
    emitBillingEvent: async (event) => {
      state.billingEvents.push(event);
    },
    countStep: (step) => state.steps.push(step),
    config: {
      NODE_ENV: "test",
      CONTACT_TURNSTILE_SECRET: "",
      MESSAGE_PROVIDER: "dev",
      TRIAL_DAYS: 14,
      TRIAL_OTP_DAILY_CAP: 200,
      TRIAL_ALLOWED_DIAL_CODES: ["502"],
      APP_ORIGIN: "http://localhost:3001",
    },
    now: () => now,
    log: { warn: () => {}, info: () => {} },
    ...overrides,
  };
  return { state, business, service: createTrialSignupService(deps), deps };
}

const rejects = (promise, status, code) =>
  assert.rejects(promise, (/** @type {any} */ error) => {
    assert.equal(error.statusCode, status, error.message);
    if (code) assert.equal(error.code, code);
    return true;
  });

test("request-code: Turnstile fails closed, the dial-code allowlist and the daily SMS cap apply before any code is issued", async () => {
  const { state, service } = fixture();
  state.turnstile = false;
  await rejects(service.requestCode({ phone, turnstileToken: "bad" }), 400, "TURNSTILE_FAILED");
  state.turnstile = true;
  await rejects(
    service.requestCode({ phone: "+1 415 555 0100", turnstileToken: "ok" }),
    400,
    "TRIAL_PHONE_NOT_ALLOWED",
  );
  await rejects(service.requestCode({ phone: "123", turnstileToken: "ok" }), 400);
  state.issuedToday = 200;
  await rejects(service.requestCode({ phone, turnstileToken: "ok" }), 503, "TRIAL_OTP_CAP");
  assert.equal(state.codes.length, 0);
  assert.equal(state.messages.length, 0);
  assert.deepEqual(state.steps, []);
});

test("request-code issues the platform phone proof with the fixed SMS body and exposes dev_code only with the dev provider", async () => {
  const { state, service } = fixture();
  const out = await service.requestCode({ phone: "5555-1234", turnstileToken: "ok" });
  assert.equal(out.ok, true);
  assert.equal(out.phone, phone, "local GT numbers gain the 502 dial code");
  assert.match(out.dev_code, /^\d{6}$/);
  assert.equal(state.codes.length, 1);
  assert.equal(state.codes[0].phone, phone);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].channel, "verify");
  assert.equal(state.messages[0].privilegedLog, true);
  assert.equal(state.messages[0].businessId, null);
  assert.equal(
    state.messages[0].body,
    `Tu código de PuntosFieles: ${out.dev_code} (expira en 10 minutos)`,
  );
  assert.deepEqual(state.steps, ["code_requested"]);

  const prod = fixture({
    config: {
      NODE_ENV: "production",
      CONTACT_TURNSTILE_SECRET: "secret",
      MESSAGE_PROVIDER: "waha",
      TRIAL_DAYS: 14,
      TRIAL_OTP_DAILY_CAP: 200,
      TRIAL_ALLOWED_DIAL_CODES: ["502"],
      APP_ORIGIN: "https://app.puntosfieles.com",
    },
  });
  const sent = await prod.service.requestCode({ phone, turnstileToken: "ok" });
  assert.equal(sent.dev_code, undefined);
});

test("request-code honours the per-phone proof limits (1 per minute, 5 per hour)", async () => {
  const { service, deps } = fixture();
  deps.accessRepo.requestCounts = async () => ({ minute: 1, hour: 1 });
  await rejects(service.requestCode({ phone, turnstileToken: "ok" }), 429);
});

test("verify: a wrong code counts an attempt, an expired code is refused, a used phone is refused after proving possession", async () => {
  const { state, service } = fixture();
  await rejects(service.verify({ phone, code: "000000" }), 401, "TRIAL_CODE_INVALID");
  assert.equal(state.failed, 1);
  assert.equal(state.grants.size, 0);
  await rejects(service.verify({ phone, code: "12345" }), 401, "TRIAL_CODE_INVALID");
  state.consumed = true; // expired or already used: no active code
  await rejects(service.verify({ phone, code: "123456" }), 401, "TRIAL_CODE_INVALID");
  state.consumed = false;
  state.phonesWithTrial.add(phone);
  await rejects(service.verify({ phone, code: "123456" }), 409, "TRIAL_PHONE_USED");
  assert.equal(state.grants.size, 0, "no grant for a phone that already owns a trial");
  assert.equal(state.consumed, true, "the code was still consumed");
});

test("verify issues a hashed single-use grant that signup consumes to create a Conecta trial through the shared creation path", async () => {
  const { state, service, business } = fixture();
  const verified = await service.verify({ phone, code: "123456" });
  assert.equal(verified.ok, true);
  assert.match(verified.grant, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(verified.expires_at, new Date(now.getTime() + 5 * 60_000).toISOString());
  assert.ok(state.grants.has(hashSessionToken(verified.grant)), "only the hash is stored");
  assert.deepEqual(state.steps, ["code_verified"]);

  await rejects(
    service.signup({
      grant: "x".repeat(43),
      businessName: "Café Prueba",
      email: "owner@example.com",
      password: "OrchardLanternMarble2026!",
      turnstileToken: "ok",
    }),
    401,
    "TRIAL_GRANT_INVALID",
  );
  const out = await service.signup({
    grant: verified.grant,
    businessName: "Café Prueba",
    email: "Owner@Example.com ",
    password: "OrchardLanternMarble2026!",
    category: "cafe",
    turnstileToken: "ok",
    plan: "negocio",
  });
  assert.equal(state.created.length, 1);
  const input = state.created[0];
  assert.equal(input.plan, "EMPRENDEDOR");
  assert.equal(input.email, "owner@example.com");
  assert.equal(input.phone, phone);
  assert.deepEqual(input.program_json, {}, "no silent default rule");
  assert.equal(input.signup.source, "self_serve");
  assert.equal(input.signup.trial_phone, phone);
  assert.equal(input.signup.trial_days, 14);
  assert.equal(input.signup.now, now);
  assert.equal(out.business, business);
  assert.equal(out.ownerId, ownerId);
  assert.equal(out.branchId, branchId);
  assert.equal(out.trial.status, "active");
  assert.equal(out.trial.days_left, 14);
  assert.equal(out.intended_plan, "NEGOCIO");
  assert.deepEqual(state.steps, ["code_verified", "created"]);
  assert.equal(state.billingEvents.length, 1);
  assert.equal(state.billingEvents[0].eventType, "trial.started");
  assert.equal(state.billingEvents[0].metadata.intended_plan, "NEGOCIO");
  assert.equal(state.emails.length, 1);
  assert.equal(state.emails[0].kind, "welcome");
  assert.equal(state.emails[0].to, "owner@example.com");
  assert.equal(state.emails[0].context.joinUrl, "http://localhost:3001/registro/cafe-prueba");
  assert.deepEqual(
    state.markers.map((m) => m.kind),
    ["welcome"],
  );

  // The grant is single use.
  await rejects(
    service.signup({
      grant: verified.grant,
      businessName: "Otro",
      email: "other@example.com",
      password: "OrchardLanternMarble2026!",
      turnstileToken: "ok",
    }),
    401,
    "TRIAL_GRANT_INVALID",
  );
  assert.equal(state.created.length, 1);
});

test("signup refuses a duplicate email or phone, fails closed on Turnstile, and restores the grant when creation fails", async () => {
  const { state, service } = fixture();
  const { grant } = await service.verify({ phone, code: "123456" });
  const payload = {
    grant,
    businessName: "Café Prueba",
    email: "owner@example.com",
    password: "OrchardLanternMarble2026!",
    turnstileToken: "ok",
  };
  state.turnstile = false;
  await rejects(service.signup(payload), 400, "TURNSTILE_FAILED");
  state.turnstile = true;
  state.existingEmails.add("owner@example.com");
  await rejects(service.signup(payload), 409);
  state.existingEmails.clear();
  assert.equal(state.created.length, 0);

  state.createError = Object.assign(new Error("dup"), {
    code: "23505",
    constraint: "businesses_trial_phone_unique",
  });
  await rejects(service.signup(payload), 409, "TRIAL_PHONE_USED");
  const stored = [...state.grants.values()][0];
  assert.equal(stored.consumed, false, "grant restored for a retry");

  state.createError = new Error("database unavailable");
  await assert.rejects(service.signup(payload), /database unavailable/);
  assert.equal(stored.consumed, false);

  state.createError = null;
  state.phonesWithTrial.add(phone);
  await rejects(service.signup(payload), 409, "TRIAL_PHONE_USED");
  assert.equal(state.steps.includes("created"), false);
});

test("self-serve signup is offered only when Turnstile protects production and the SMS cap is not zero", async () => {
  assert.equal(
    trialSignupAvailable({
      NODE_ENV: "test",
      CONTACT_TURNSTILE_SECRET: "",
      TRIAL_OTP_DAILY_CAP: 200,
    }),
    true,
  );
  assert.equal(
    trialSignupAvailable({
      NODE_ENV: "production",
      CONTACT_TURNSTILE_SECRET: "",
      TRIAL_OTP_DAILY_CAP: 200,
    }),
    false,
  );
  assert.equal(
    trialSignupAvailable({
      NODE_ENV: "production",
      CONTACT_TURNSTILE_SECRET: "s",
      TRIAL_OTP_DAILY_CAP: 200,
    }),
    true,
  );
  assert.equal(
    trialSignupAvailable({
      NODE_ENV: "test",
      CONTACT_TURNSTILE_SECRET: "",
      TRIAL_OTP_DAILY_CAP: 0,
    }),
    false,
  );
  const { service, state } = fixture({
    config: {
      NODE_ENV: "production",
      CONTACT_TURNSTILE_SECRET: "",
      MESSAGE_PROVIDER: "dev",
      TRIAL_DAYS: 14,
      TRIAL_OTP_DAILY_CAP: 200,
      TRIAL_ALLOWED_DIAL_CODES: ["502"],
      APP_ORIGIN: "https://app.puntosfieles.com",
    },
  });
  assert.equal(service.available(), false);
  await rejects(
    service.requestCode({ phone, turnstileToken: "ok" }),
    503,
    "TRIAL_SIGNUP_UNAVAILABLE",
  );
  await rejects(service.verify({ phone, code: "123456" }), 503, "TRIAL_SIGNUP_UNAVAILABLE");
  assert.equal(state.codes.length, 0);
  assert.doesNotThrow(() => assertAllowedDialCode("15555550100", []));
  assert.throws(() => assertAllowedDialCode("15555550100", ["502"]), /Guatemala/);
});
