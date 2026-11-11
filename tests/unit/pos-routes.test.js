import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_DRIVER = "memory";

const { createAdminPosRoutes, adminPosRoutes } = await import("../../src/app/routes/admin/pos-routes.js");
const { createPosRoutes, posRoutes } = await import("../../src/app/routes/pos-routes.js");
const { BusinessRepo } = await import("../../src/app/repositories/business-repository.js");
const { PlanConfigService } = await import("../../src/app/services/plan-config-service.js");
const { SecurityEventRepo } = await import("../../src/app/repositories/security-event-repository.js");
const { errorHandler } = await import("../../src/middleware/common.js");
const { requireStaff, requireOwner } = await import("../../src/middleware/auth.js");
const { tenantContext } = await import("../../src/middleware/tenant.js");
const { csrfProtect } = await import("../../src/middleware/csrf.js");
const { moderateRateLimit } = await import("../../src/middleware/rate-limit.js");
const { badRequest } = await import("../../src/utils/http-error.js");

const BUSINESS = {
  id: "business-owner",
  slug: "cafe-gt",
  plan: "EMPRESA",
  program_json: {
    pos_integration: { enabled: true, mode: "api" },
    external_awards: { enabled: true, api_key: "route-test-pos-key" }
  }
};
const SALE = { saleId: "sale-123", customerPhone: "50255554444", amountQ: 25, currency: "GTQ", status: "paid" };
const ADMIN_ENDPOINTS = [
  ["GET", "/admin/pos", "getPosIntegration"],
  ["PUT", "/admin/pos", "configurePosIntegration"],
  ["POST", "/admin/pos/key", "rotatePosKey"],
  ["POST", "/admin/pos/csv/preview", "previewCsv"],
  ["POST", "/admin/pos/csv/import", "importCsv"],
  ["POST", "/admin/pos/loyverse/preview", "previewLoyverse"],
  ["POST", "/admin/pos/loyverse/sync", "syncLoyverseBusiness"],
  ["GET", "/admin/pos/refunds", "listPosRefunds"],
  ["POST", "/admin/pos/refunds/:id/retry", "reconcilePosRefund"]
];

async function withServer(router, run) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => {
    /** @type {import("node:http").IncomingMessage & { rawBody?: string }} */ (req).rawBody = buffer.toString("utf8");
  } }));
  app.use(cookieParser());
  app.use("/api/v1", router);
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  /**
   * @param {string} method
   * @param {string} path
   * @param {{body?: unknown, csrf?: boolean, headers?: Record<string, string>}} [options]
   */
  const request = async (method, path, { body, csrf = true, headers = {} } = {}) => {
    const response = await fetch(`${origin}/api/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(csrf ? { origin, cookie: "pf_csrf=route-test-csrf", "x-csrf-token": "route-test-csrf" } : {}),
        ...headers
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) })
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try {
    await run(request);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(undefined)));
  }
}

function adminDeps(t, { role = "OWNER", plan = "EMPRESA", overrides = {} } = {}) {
  const calls = [];
  t.mock.method(BusinessRepo, "getById", async (businessId) => {
    assert.equal(businessId, BUSINESS.id);
    return { ...BUSINESS, plan };
  });
  t.mock.method(PlanConfigService, "getPlanFeatureOverrides", async () => overrides);
  t.mock.method(SecurityEventRepo, "log", async () => {});
  const deps = {
    requireStaff(req, _res, next) {
      req.staff = { id: "staff-owner", business_id: BUSINESS.id, role };
      next();
    }
  };
  for (const [, , name] of ADMIN_ENDPOINTS) {
    deps[name] = async (...args) => {
      calls.push({ name, args });
      return { ok: true, operation: name };
    };
  }
  return { deps, calls };
}

/**
 * @param {{business?: typeof BUSINESS | null, overrides?: Record<string, Record<string, boolean>>, result?: Record<string, unknown>}} [options]
 */
function publicDeps({ business = BUSINESS, overrides = {}, result = { ok: true, result: { awarded: 1 } } } = {}) {
  const calls = [];
  const deps = {
    BusinessRepo: {
      async getPublicBySlug(slug) {
        calls.push(["lookup", slug]);
        return business ? { id: business.id, slug } : null;
      },
      async getById(id) {
        calls.push(["business", id]);
        return business;
      }
    },
    async setTenantForRequest(req, id) {
      req.tenantId = id;
      calls.push(["tenant", id]);
    },
    PlanConfigService: { async getPlanFeatureOverrides() { return overrides; } },
    async ingestPosSale(business, input) {
      calls.push(["ingest", business.id, input]);
      return result;
    },
    async ingestPosRefund(business, input) {
      calls.push(["ingest_refund", business.id, input]);
      return result;
    }
  };
  return { deps, calls };
}

test("every owner POS endpoint wires staff, owner, tenant and plan protection plus CSRF for mutations", () => {
  for (const [method, path] of ADMIN_ENDPOINTS) {
    const layer = adminPosRoutes.stack.find(({ route }) => route?.path === path && route.stack.some((entry) => entry.method === method.toLowerCase()));
    assert.ok(layer, `${method} ${path}`);
    const handlers = layer.route.stack.map(({ handle }) => /** @type {typeof handle & { __openapi?: { planFeatures?: string[], csrfRequired?: boolean } }} */ (handle));
    assert.deepEqual(handlers.slice(0, 3), [requireStaff, requireOwner, tenantContext]);
    assert.ok(handlers.some((handler) => handler.__openapi?.planFeatures?.includes("external_awards")));
    assert.equal(handlers.includes(csrfProtect), method !== "GET");
  }
  const publicLayer = posRoutes.stack.find(({ route }) => route?.path === "/public/pos/:slug/sales");
  assert.equal(publicLayer.route.stack[0].handle, moderateRateLimit);
});

test("refund ingestion shares Bearer/HMAC authentication and tenant lookup with sales", async () => {
  const body = { refundId: "r-1", originalSaleId: "s-1", source: "register", amountQ: 40, currency: "GTQ" };
  const result = { ok: true, refund: { status: "pending", reason: "partial_refund" } };
  const { deps, calls } = publicDeps({ result });
  const signature = crypto.createHmac("sha256", "route-test-pos-key").update(JSON.stringify(body)).digest("hex");
  await withServer(createPosRoutes(deps), async request => {
    for (const headers of [{ authorization: "Bearer route-test-pos-key" }, { "x-signature": signature }]) {
      const response = await request("POST", "/public/pos/cafe-gt/refunds", { body, csrf: false, headers });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, result);
    }
    const bad = await request("POST", "/public/pos/cafe-gt/refunds", { body, csrf: false });
    assert.equal(bad.status, 401);
  });
  assert.equal(calls.filter(([name]) => name === "ingest_refund").length, 2);
});

test("all owner POS endpoints reject missing authentication", async () => {
  await withServer(adminPosRoutes, async (request) => {
    for (const [method, path] of ADMIN_ENDPOINTS) {
      const response = await request(method, path);
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(response.body.code, "AUTH_REQUIRED");
    }
  });
});

test("all owner POS endpoints reject cashiers before any service work", async (t) => {
  const { deps, calls } = adminDeps(t, { role: "CASHIER" });
  await withServer(createAdminPosRoutes(deps), async (request) => {
    for (const [method, path] of ADMIN_ENDPOINTS) {
      const response = await request(method, path);
      assert.equal(response.status, 403);
      assert.equal(response.body.code, "RBAC_ROLE_REQUIRED");
    }
  });
  assert.deepEqual(calls, []);
});

test("all owner POS endpoints enforce the external awards plan feature", async (t) => {
  const { deps, calls } = adminDeps(t, { plan: "NEGOCIO" });
  await withServer(createAdminPosRoutes(deps), async (request) => {
    for (const [method, path] of ADMIN_ENDPOINTS) {
      const response = await request(method, path);
      assert.equal(response.status, 403);
      assert.equal(response.body.code, "PLAN_FEATURE_LOCKED");
      assert.equal(response.body.feature, "external_awards");
    }
  });
  assert.deepEqual(calls, []);
});

test("every owner POS mutation requires CSRF before service work", async (t) => {
  const { deps, calls } = adminDeps(t);
  await withServer(createAdminPosRoutes(deps), async (request) => {
    for (const [method, path] of ADMIN_ENDPOINTS.filter(([method]) => method !== "GET")) {
      const response = await request(method, path, { csrf: false });
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.match(response.body.error, /CSRF/);
    }
  });
  assert.deepEqual(calls, []);
});

test("authorized owner calls use the session tenant and respect configured plan overrides", async (t) => {
  const { deps, calls } = adminDeps(t, { plan: "NEGOCIO", overrides: { NEGOCIO: { external_awards: true } } });
  const body = { businessId: "another-business", csv: "id,total\n1,25" };
  await withServer(createAdminPosRoutes(deps), async (request) => {
    for (const [method, path, name] of ADMIN_ENDPOINTS) {
      const response = await request(method, path, { body });
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.deepEqual(response.body, { ok: true, operation: name });
      assert.equal(calls.at(-1).args[0], BUSINESS.id);
      if (["configurePosIntegration", "previewCsv", "importCsv"].includes(name)) {
        assert.deepEqual(calls.at(-1).args[1], body);
      }
    }
  });
  assert.equal(calls.length, ADMIN_ENDPOINTS.length);
});

test("owner service validation errors flow through the shared error handler", async (t) => {
  const { deps } = adminDeps(t);
  deps.configurePosIntegration = async () => { throw badRequest("Configuración POS inválida"); };
  await withServer(createAdminPosRoutes(deps), async (request) => {
    const response = await request("PUT", "/admin/pos");
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Configuración POS inválida");
    assert.ok(response.body.request_id);
  });
});

test("public POS authenticates Bearer credentials and resolves tenant before processing", async () => {
  const { deps, calls } = publicDeps();
  await withServer(createPosRoutes(deps), async (request) => {
    const response = await request("POST", "/public/pos/cafe-gt/sales", {
      body: SALE, csrf: false, headers: { authorization: "Bearer route-test-pos-key" }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, result: { awarded: 1 } });
    assert.equal(response.headers.get("x-ratelimit-limit"), "60");
  });
  assert.deepEqual(calls, [["lookup", "cafe-gt"], ["tenant", BUSINESS.id], ["business", BUSINESS.id], ["ingest", BUSINESS.id, SALE]]);
});

test("public POS accepts an HMAC of the raw body and preserves dry-run preview responses", async () => {
  const body = { ...SALE, dryRun: true };
  const result = { ok: true, dryRun: true, rows: [{ row: 1, status: "ready" }], summary: { total: 1, ready: 1, errors: 0, ignored: 0, duplicates: 0 } };
  const { deps } = publicDeps({ result });
  const signature = crypto.createHmac("sha256", "route-test-pos-key").update(JSON.stringify(body)).digest("hex");
  await withServer(createPosRoutes(deps), async (request) => {
    const response = await request("POST", "/public/pos/cafe-gt/sales", { body, csrf: false, headers: { "x-signature": signature } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, result);
  });
});

test("public POS rejects absent, invalid, query and body credentials before validating sales", async () => {
  const { deps, calls } = publicDeps();
  await withServer(createPosRoutes(deps), async (request) => {
    for (const options of [
      {},
      { headers: { authorization: "Bearer invalid-key" } },
      { headers: { "x-signature": "invalid-signature" } },
      { body: { api_key: "route-test-pos-key" } }
    ]) {
      const response = await request("POST", "/public/pos/cafe-gt/sales?api_key=route-test-pos-key", { csrf: false, ...options });
      assert.equal(response.status, 401);
    }
  });
  assert.equal(calls.some(([name]) => name === "ingest"), false);
});

test("public POS rejects unknown businesses without tenant access", async () => {
  const { deps, calls } = publicDeps({ business: null });
  await withServer(createPosRoutes(deps), async (request) => {
    const response = await request("POST", "/public/pos/missing/sales", { body: SALE });
    assert.equal(response.status, 404);
  });
  assert.deepEqual(calls, [["lookup", "missing"]]);
});

test("public POS only reveals a disabled integration after authenticating credentials", async () => {
  const business = { ...BUSINESS, program_json: { ...BUSINESS.program_json, pos_integration: { ...BUSINESS.program_json.pos_integration, enabled: false } } };
  const { deps, calls } = publicDeps({ business });
  await withServer(createPosRoutes(deps), async (request) => {
    for (const [authorization, expectedStatus] of [["Bearer wrong", 401], ["Bearer route-test-pos-key", 403]]) {
      const response = await request("POST", "/public/pos/cafe-gt/sales", { body: SALE, headers: { authorization } });
      assert.equal(response.status, expectedStatus);
    }
  });
  assert.equal(calls.some(([name]) => name === "ingest"), false);
});

test("public POS checks plan feature overrides for the resolved business", async () => {
  for (const { overrides, expectedStatus } of [
    { overrides: {}, expectedStatus: 200 },
    { overrides: { EMPRESA: { external_awards: false } }, expectedStatus: 403 }
  ]) {
    const { deps, calls } = publicDeps({ overrides });
    await withServer(createPosRoutes(deps), async (request) => {
      const response = await request("POST", "/public/pos/cafe-gt/sales", { body: SALE, headers: { authorization: "Bearer route-test-pos-key" } });
      assert.equal(response.status, expectedStatus);
      if (expectedStatus === 403) {
        assert.equal(response.body.code, "PLAN_FEATURE_LOCKED");
        assert.equal(response.body.feature, "external_awards");
      }
    });
    assert.equal(calls.some(([name]) => name === "ingest"), expectedStatus === 200);
  }
});

for(const [path,handler] of [['lookup','lookupPosRedemption'],['mappings','getPosRewardMappings'],['events','recordPosFulfillmentEvent']])test(`redemption ${path} requires HMAC, tenant and appropriate recovery gates`,async()=>{
 const body={source:'test'},signature=crypto.createHmac('sha256','route-test-pos-key').update(JSON.stringify(body)).digest('hex');
 const scenarios=/** @type {{overrides:Record<string,Record<string,boolean>>,status:number}[]} */([{overrides:{},status:200},{overrides:{EMPRESA:{redemptions:false}},status:403},{overrides:{EMPRESA:{external_awards:false}},status:403}]);
 for(const {overrides,status} of scenarios){
  const {deps}=publicDeps({overrides});let called=0;deps[handler]=async(b,input,options)=>{assert.equal(b.id,BUSINESS.id);assert.deepEqual(input,body);if(path==='events'){assert.equal(options.enforceConnection,true);assert.deepEqual(await options.getPlanFeatureOverrides(),overrides);}called++;return{ok:true};};
  const expected=path==='events'?200:status;
  await withServer(createPosRoutes(deps),async request=>{
   assert.equal((await request('POST',`/public/pos/cafe-gt/redemptions/${path}`,{body,csrf:false,headers:{authorization:'Bearer route-test-pos-key'}})).status,401);
   assert.equal((await request('POST',`/public/pos/cafe-gt/redemptions/${path}`,{body,csrf:false,headers:{'x-signature':'0'.repeat(64)}})).status,401);
   const response=await request('POST',`/public/pos/cafe-gt/redemptions/${path}`,{body,csrf:false,headers:{'x-signature':signature}});assert.equal(response.status,expected);if(expected===200)assert.equal(response.headers.get('cache-control'),'no-store');
  });assert.equal(called,expected===200?1:0);
 }
});
