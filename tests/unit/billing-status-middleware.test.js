import test from "node:test";
import assert from "node:assert/strict";
import {
  apiPathOf,
  enforceTrialLock,
  requireActiveBilling,
  trialLockApplies,
  trialLockedBody,
  TRIAL_LOCK_EXEMPT_PATTERNS,
} from "../../src/middleware/billing-status.js";
import { trialState } from "../../src/app/services/trial-state.js";

const DAY = 86_400_000;
const now = new Date("2026-12-10T15:00:00.000Z");
const businessId = "22222222-2222-4222-8222-222222222222";

/** @returns {any} */
function business(overrides = {}) {
  return {
    id: businessId,
    plan: "EMPRENDEDOR",
    program_json: {},
    trial_status: "active",
    billing_status: "trialing",
    trial_started_at: new Date(now.getTime() - 5 * DAY),
    trial_ends_at: new Date(now.getTime() + 9 * DAY),
    locked_at: null,
    purge_after: null,
    ...overrides,
  };
}

/** @returns {any} */
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

/** @param {object} overrides */
/** @returns {any} */
function makeReq(overrides = {}) {
  return {
    method: "POST",
    originalUrl: "/api/v1/admin/rewards",
    staff: { id: "s1", business_id: businessId, role: "OWNER" },
    ...overrides,
  };
}

test("the lock applies to mutating API requests except the session, trial, billing, public and support routes", () => {
  assert.equal(
    apiPathOf(/** @type {any} */ ({ originalUrl: "/api/v1/admin/rewards?x=1" })),
    "/admin/rewards",
  );
  assert.equal(apiPathOf(/** @type {any} */ ({ originalUrl: "/api/staff/award" })), "/staff/award");
  assert.equal(apiPathOf(/** @type {any} */ ({ url: "/api/v1" })), "/");
  assert.equal(trialLockApplies("GET", "/admin/rewards"), false);
  assert.equal(trialLockApplies("HEAD", "/admin/rewards"), false);
  assert.equal(trialLockApplies("POST", "/admin/rewards"), true);
  assert.equal(trialLockApplies("PUT", "/admin/program"), true);
  assert.equal(trialLockApplies("PATCH", "/admin/customers/1"), true);
  assert.equal(trialLockApplies("DELETE", "/admin/webhooks/1"), true);
  assert.equal(trialLockApplies("POST", "/staff/award"), true);
  assert.equal(trialLockApplies("POST", "/staff/redeem"), true);
  assert.equal(trialLockApplies("POST", "/staff/sync"), true);
  for (const exempt of [
    "/staff/login",
    "/staff/logout",
    "/staff/me",
    "/staff/permissions",
    "/staff/security/reauth",
    "/staff/security/mfa/enroll",
    "/admin/signup",
    "/admin/trial",
    "/admin/billing/checkout",
    "/public/support/cases",
    "/support/cases",
  ])
    assert.equal(trialLockApplies("POST", exempt), false, exempt);
  assert.equal(trialLockApplies("POST", "/admin/trialx"), true, "prefix match is anchored");
  assert.ok(TRIAL_LOCK_EXEMPT_PATTERNS.length >= 8);
});

test("a locked business receives 402 TRIAL_LOCKED with Spanish copy per role and the upgrade path", async () => {
  const reads = [];
  const deps = {
    getBusiness: async (id) => {
      reads.push(id);
      return business({ billing_status: "locked", trial_status: "expired", locked_at: now });
    },
    now: () => now,
  };
  const req = makeReq();
  const res = makeRes();
  assert.equal(await enforceTrialLock(req, res, deps), true);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "TRIAL_LOCKED");
  assert.equal(res.body.trial_status, "locked");
  assert.equal(res.body.upgrade_url, "/negocio/#plan");
  assert.match(res.body.error, /Tu prueba terminó\. Elige un plan/);
  assert.deepEqual(reads, [businessId]);
  // The business row is cached on the request for the plan-feature middleware.
  assert.equal(req._resolvedBusiness.id, businessId);
  assert.equal(await enforceTrialLock(req, makeRes(), deps), true);
  assert.equal(reads.length, 1, "second check reuses the cached row");

  const cashier = makeReq({
    originalUrl: "/api/staff/award",
    staff: { id: "s2", business_id: businessId, role: "CASHIER" },
  });
  const cashierRes = makeRes();
  assert.equal(await enforceTrialLock(cashier, cashierRes, deps), true);
  assert.equal(cashierRes.statusCode, 402);
  assert.match(cashierRes.body.error, /pausa.*dueño/);
  const body = trialLockedBody(
    trialState(business({ billing_status: "locked" }), { now }),
    "MANAGER",
  );
  assert.match(body.error, /El programa está en pausa/);
});

test("a trialing business past trial_ends_at is locked before the daily job runs; active, converted and legacy businesses pass", async () => {
  /** @type {Array<[any, boolean, string]>} */
  const cases = [
    [
      business({ trial_ends_at: new Date(now.getTime() - 60_000) }),
      true,
      "past end (pending lock)",
    ],
    [business(), false, "active trial"],
    [business({ trial_ends_at: new Date(now.getTime() + 60_000) }), false, "last hour"],
    [
      business({ trial_status: "converted", billing_status: "active" }),
      false,
      "converted (manual or paid)",
    ],
    [
      business({ trial_status: "converted", billing_status: "past_due" }),
      false,
      "past due keeps access in the grace window",
    ],
    [
      business({
        trial_status: "none",
        billing_status: "none",
        trial_started_at: null,
        trial_ends_at: null,
      }),
      false,
      "legacy business",
    ],
  ];
  for (const [row, locked, label] of cases) {
    const res = makeRes();
    const stopped = await enforceTrialLock(makeReq(), res, {
      getBusiness: async () => row,
      now: () => now,
    });
    assert.equal(stopped, locked, label);
    assert.equal(res.statusCode, locked ? 402 : 200, label);
  }
});

test("reads, exempt routes and requests without a business never touch the database", async () => {
  let reads = 0;
  const deps = {
    getBusiness: async () => {
      reads += 1;
      return business({ billing_status: "locked" });
    },
    now: () => now,
  };
  for (const req of [
    makeReq({ method: "GET" }),
    makeReq({ originalUrl: "/api/v1/staff/logout" }),
    makeReq({ originalUrl: "/api/admin/trial" }),
    makeReq({ staff: undefined }),
  ]) {
    const res = makeRes();
    assert.equal(await enforceTrialLock(req, res, deps), false);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(reads, 0);
});

test("requireActiveBilling is the standalone middleware form", async () => {
  const locked = requireActiveBilling({
    getBusiness: async () => business({ billing_status: "locked" }),
    now: () => now,
  });
  const res = makeRes();
  let nexts = 0;
  await locked(makeReq(), res, () => nexts++);
  assert.equal(res.statusCode, 402);
  assert.equal(nexts, 0);
  const open = requireActiveBilling({ getBusiness: async () => business(), now: () => now });
  const openRes = makeRes();
  await open(makeReq(), openRes, () => nexts++);
  assert.equal(nexts, 1);
  assert.equal(openRes.statusCode, 200);
  // A business row that cannot be read never turns into a lock or a 500: the request
  // proceeds (its own database work fails the same way) and the skip is logged.
  const warnings = [];
  const failing = requireActiveBilling({
    getBusiness: async () => {
      throw new Error("db down");
    },
    log: { warn: (ctx, msg) => warnings.push([ctx, msg]) },
  });
  const errors = [];
  let passed = 0;
  await failing(makeReq(), makeRes(), (err) => (err ? errors.push(err) : passed++));
  assert.equal(errors.length, 0);
  assert.equal(passed, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0].err, "db down");
  assert.match(warnings[0][1], /skipped/);
  assert.deepEqual(open.__openapi, { auth: "staff" });
});
