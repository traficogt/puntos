process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "http://app.test";
process.env.DB_HOST = "localhost";
process.env.DB_NAME = "puntos";
process.env.DB_USER = "puntos";
process.env.DB_PASSWORD = "test-db-password-12345";
process.env.JWT_SECRET = "test-jwt-secret-abcdefghijklmnopqrstuvwxyz";
process.env.STAFF_COOKIE_NAME = "pf_staff";
process.env.CUSTOMER_COOKIE_NAME = "pf_customer";

import { test } from "node:test";
import assert from "node:assert/strict";

const { config } = await import("../../src/config/index.js");
const { superRoutes } = await import("../../src/app/routes/super-routes.js");
const { publicRoutes } = await import("../../src/app/routes/public-routes.js");
const { StaffRepo } = await import("../../src/app/repositories/staff-repository.js");
const { CustomerRepo } = await import("../../src/app/repositories/customer-repository.js");
const { InternalMagicLinkRepo } = await import("../../src/app/repositories/internal-magic-link-repository.js");
const { AuditRepo } = await import("../../src/app/repositories/audit-repository.js");

function routeLayer(router, path, method) {
  return router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    redirectedTo: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
      return this;
    },
    redirect(...args) {
      if (args.length === 1) {
        this.statusCode = 302;
        this.redirectedTo = args[0];
      } else {
        this.statusCode = args[0];
        this.redirectedTo = args[1];
      }
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function runFinalHandler(layer, req) {
  const res = makeRes();
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  await new Promise((resolve, reject) => {
    try {
      const maybe = handler(req, res, (err) => (err ? reject(err) : resolve()));
      if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
      else resolve();
    } catch (error) {
      reject(error);
    }
  });
  return res;
}

test("super magic-link generation returns an owner panel link and audits it", async () => {
  const layer = routeLayer(superRoutes, "/super/magic-links", "post");
  assert.ok(layer, "Expected POST /super/magic-links");

  const staffId = "11111111-1111-4111-8111-111111111111";
  const businessId = "22222222-2222-4222-8222-222222222222";
  const createdRecords = [];
  const auditRecords = [];
  const originalGetById = StaffRepo.getById;
  const originalCreate = InternalMagicLinkRepo.create;
  const originalAuditLog = AuditRepo.log;

  StaffRepo.getById = async () => ({
    id: staffId,
    business_id: businessId,
    branch_id: "branch-1",
    role: "OWNER"
  });
  InternalMagicLinkRepo.create = async (record) => {
    createdRecords.push(record);
    return { id: record.id };
  };
  AuditRepo.log = async (record) => {
    auditRecords.push(record);
    return { id: record.id };
  };

  try {
    const res = await runFinalHandler(layer, {
      method: "POST",
      body: {
        actorType: "staff",
        actorId: staffId,
        businessId,
        target: "admin-dashboard"
      },
      superAdmin: { email: "super@example.com" },
      headers: { "user-agent": "test-agent" },
      ip: "127.0.0.1"
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.usageMode, "single_use");
    assert.equal(createdRecords.length, 1);
    assert.equal(createdRecords[0].created_by, "super@example.com");
    assert.equal(createdRecords[0].actor_type, "staff");
    assert.equal(createdRecords[0].business_id, businessId);
    assert.equal(createdRecords[0].target, "admin-dashboard");
    assert.equal(auditRecords.length, 1);
    assert.equal(auditRecords[0].action, "super.magic_link.create");
    assert.equal(auditRecords[0].meta.actor_type, "staff");
    assert.equal(auditRecords[0].meta.actor_id, staffId);
    assert.equal(auditRecords[0].meta.business_id, businessId);
    assert.match(res.body.url, /^http:\/\/app\.test\/magic\/staff\/.+$/);
  } finally {
    StaffRepo.getById = originalGetById;
    InternalMagicLinkRepo.create = originalCreate;
    AuditRepo.log = originalAuditLog;
  }
});

test("super magic-link generation rejects actor and business mismatches", async () => {
  const layer = routeLayer(superRoutes, "/super/magic-links", "post");
  assert.ok(layer, "Expected POST /super/magic-links");

  const customerId = "44444444-4444-4444-8444-444444444444";
  const requestBusinessId = "22222222-2222-4222-8222-222222222222";
  const createdRecords = [];
  const originalGetById = CustomerRepo.getById;
  const originalCreate = InternalMagicLinkRepo.create;

  CustomerRepo.getById = async () => ({
    id: customerId,
    business_id: "33333333-3333-4333-8333-333333333333"
  });
  InternalMagicLinkRepo.create = async (record) => {
    createdRecords.push(record);
    return { id: record.id };
  };

  try {
    const res = await runFinalHandler(layer, {
      method: "POST",
      body: {
        actorType: "customer",
        actorId: customerId,
        businessId: requestBusinessId,
        target: "customer-wallet"
      },
      superAdmin: { email: "super@example.com" }
    });

    assert.equal(res.statusCode, 400);
    assert.match(String(res.body?.error || ""), /no pertenece/i);
    assert.equal(createdRecords.length, 0);
  } finally {
    CustomerRepo.getById = originalGetById;
    InternalMagicLinkRepo.create = originalCreate;
  }
});

test("customer magic-link route redirects to /c and sets the customer cookie", async () => {
  const layer = routeLayer(publicRoutes, "/magic/customer/:token", "get");
  assert.ok(layer, "Expected GET /magic/customer/:token");

  const customerId = "55555555-5555-4555-8555-555555555555";
  const businessId = "66666666-6666-4666-8666-666666666666";
  const originalLookup = InternalMagicLinkRepo.lookupByTokenHash;
  const originalTouch = InternalMagicLinkRepo.touchReusable;
  const originalGetById = CustomerRepo.getById;

  InternalMagicLinkRepo.lookupByTokenHash = async () => ({
    id: "link-customer",
    actor_type: "customer",
    actor_id: customerId,
    business_id: businessId,
    target: "customer-wallet",
    usage_mode: "reusable_window",
    used_at: null,
    created_by: "super@example.com"
  });
  InternalMagicLinkRepo.touchReusable = async (id, meta) => ({
    id,
    used_at: "2026-04-03T12:00:00.000Z",
    meta
  });
  CustomerRepo.getById = async () => ({
    id: customerId,
    business_id: businessId
  });

  try {
    const res = await runFinalHandler(layer, {
      method: "GET",
      params: { token: "customer-token" },
      headers: { "user-agent": "customer-agent" },
      ip: "127.0.0.1"
    });

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, "/c");
    assert.equal(res.cookies.length, 1);
    assert.equal(res.cookies[0].name, config.CUSTOMER_COOKIE_NAME);
    assert.equal(res.cookies[0].options.httpOnly, true);
    assert.equal(res.cookies[0].options.sameSite, "strict");
  } finally {
    InternalMagicLinkRepo.lookupByTokenHash = originalLookup;
    InternalMagicLinkRepo.touchReusable = originalTouch;
    CustomerRepo.getById = originalGetById;
  }
});

test("staff magic-link route redirects to /staff and sets the staff cookie", async () => {
  const layer = routeLayer(publicRoutes, "/magic/staff/:token", "get");
  assert.ok(layer, "Expected GET /magic/staff/:token");

  const staffId = "77777777-7777-4777-8777-777777777777";
  const businessId = "88888888-8888-4888-8888-888888888888";
  const originalLookup = InternalMagicLinkRepo.lookupByTokenHash;
  const originalConsume = InternalMagicLinkRepo.consumeSingleUse;
  const originalGetById = StaffRepo.getById;
  let consumeCalls = 0;

  InternalMagicLinkRepo.lookupByTokenHash = async () => ({
    id: "link-staff",
    actor_type: "staff",
    actor_id: staffId,
    business_id: businessId,
    target: "staff",
    usage_mode: "single_use",
    used_at: null,
    created_by: "super@example.com"
  });
  InternalMagicLinkRepo.consumeSingleUse = async (id, meta) => {
    consumeCalls += 1;
    return {
      id,
      used_at: "2026-04-03T12:00:00.000Z",
      meta
    };
  };
  StaffRepo.getById = async () => ({
    id: staffId,
    business_id: businessId,
    branch_id: "branch-1",
    role: "CASHIER",
    active: true
  });

  try {
    const res = await runFinalHandler(layer, {
      method: "GET",
      params: { token: "staff-token" },
      headers: { "user-agent": "staff-agent" },
      ip: "127.0.0.1"
    });

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, "/staff");
    assert.equal(res.cookies.length, 1);
    assert.equal(res.cookies[0].name, config.STAFF_COOKIE_NAME);
    assert.equal(res.cookies[0].options.httpOnly, true);
    assert.equal(res.cookies[0].options.sameSite, "strict");
  } finally {
    InternalMagicLinkRepo.lookupByTokenHash = originalLookup;
    InternalMagicLinkRepo.consumeSingleUse = originalConsume;
    StaffRepo.getById = originalGetById;
  }
});

test("magic-link route rejects actor type mismatches safely", async () => {
  const layer = routeLayer(publicRoutes, "/magic/customer/:token", "get");
  assert.ok(layer, "Expected GET /magic/customer/:token");

  const staffId = "99999999-9999-4999-8999-999999999999";
  const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const originalLookup = InternalMagicLinkRepo.lookupByTokenHash;
  const originalConsume = InternalMagicLinkRepo.consumeSingleUse;
  const originalGetById = StaffRepo.getById;
  let consumeCalls = 0;

  InternalMagicLinkRepo.lookupByTokenHash = async () => ({
    id: "link-staff",
    actor_type: "staff",
    actor_id: staffId,
    business_id: businessId,
    target: "staff",
    usage_mode: "single_use",
    used_at: null
  });
  InternalMagicLinkRepo.consumeSingleUse = async (id, meta) => {
    consumeCalls += 1;
    return {
      id,
      used_at: "2026-04-03T12:00:00.000Z",
      meta
    };
  };
  StaffRepo.getById = async () => ({
    id: staffId,
    business_id: businessId,
    branch_id: "branch-1",
    role: "CASHIER",
    active: true
  });

  try {
    const res = await runFinalHandler(layer, {
      method: "GET",
      params: { token: "mismatch-token" },
      headers: {}
    });

    assert.equal(res.statusCode, 400);
    assert.match(String(res.body?.error || ""), /no es válido/i);
    assert.equal(res.cookies.length, 0);
    assert.equal(res.redirectedTo, null);
    assert.equal(consumeCalls, 0);
  } finally {
    InternalMagicLinkRepo.lookupByTokenHash = originalLookup;
    InternalMagicLinkRepo.consumeSingleUse = originalConsume;
    StaffRepo.getById = originalGetById;
  }
});
