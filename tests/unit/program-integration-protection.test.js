import test from "node:test";
import assert from "node:assert/strict";
import { Router } from "express";
import { runWithDbContext } from "../../src/app/database.js";
import { AuditRepo } from "../../src/app/repositories/audit-repository.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { publicRoutes } from "../../src/app/routes/public-routes.js";
import { staffRoutes } from "../../src/app/routes/staff-routes.js";
import { registerProgramConfigRoutes } from "../../src/app/routes/admin/program-config-routes.js";
import { registerProgramExternalRoutes } from "../../src/app/routes/admin/program-external-routes.js";
import { PlanConfigService } from "../../src/app/services/plan-config-service.js";

const program = {
  points_per_q: 1,
  external_awards: { enabled: true, api_key: "sandbox-api-secret" },
  pos_integration: { mode: "loyverse", loyverse: { access_token: "sandbox-pos-secret" }, last_sync: { cursor: "internal-cursor" } }
};
const business = { id: "biz-1", plan: "EMPRESARIAL", program_type: "SPEND", program_json: program };
const adminRoutes = Router();
registerProgramConfigRoutes(adminRoutes);
registerProgramExternalRoutes(adminRoutes);

async function runHandler(router, path, method, req) {
  const layer = router.stack.find(entry => entry.route?.path === path && entry.route?.methods?.[method]);
  assert.ok(layer, `Missing ${method} ${path}`);
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await layer.route.stack.at(-1).handle(req, res, error => { throw error; });
  return res;
}

for (const [label, router, path] of [
  ["public", publicRoutes, "/public/business/:slug"],
  ["staff", staffRoutes, "/staff/program"],
  ["admin", adminRoutes, "/admin/program"]
]) {
  test(`${label} program responses omit all connection details and API credentials`, async t => {
    t.mock.method(BusinessRepo, "getById", async () => structuredClone(business));
    t.mock.method(BusinessRepo, "getPublicBySlug", async () => structuredClone(business));
    const res = await runHandler(router, path, "get", { tenantId: "biz-1", params: { slug: "shop" } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.program_json, { points_per_q: 1, external_awards: { enabled: true } });
  });
}

test("basic program save ignores submitted integrations and requests atomic preservation", async t => {
  /** @type {Record<string, any>} */
  let update = {};
  t.mock.method(BusinessRepo, "getById", async () => structuredClone(business));
  t.mock.method(PlanConfigService, "getPlanFeatureOverrides", async () => ({}));
  t.mock.method(BusinessRepo, "updateProgram", async (_businessId, input) => {
    update = input;
    return structuredClone(business);
  });
  const res = await runHandler(adminRoutes, "/admin/program", "post", {
    tenantId: "biz-1", staff: { role: "OWNER" },
    body: { program_type: "SPEND", program_json: { ...program, points_per_q: 4 } }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(update.preserveIntegrations, true);
  assert.equal(update.program_json.pos_integration, undefined);
  assert.equal(update.program_json.external_awards, undefined);
  assert.equal(update.program_json.points_per_q, 4);
  assert.deepEqual(res.body.business.program_json, { points_per_q: 1, external_awards: { enabled: true } });
});

test("repository preservation merges current integration keys inside the UPDATE without a stale read", async () => {
  const calls = [];
  await runWithDbContext({ client: { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql.includes("SELECT") ? [structuredClone(business)] : [], rowCount: 1 };
  } } }, () => BusinessRepo.updateProgram("biz-1", {
    program_type: "SPEND", program_json: program, preserveIntegrations: true
  }));
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /^UPDATE businesses/);
  assert.match(calls[0].sql, /program_json\s*->\s*'pos_integration'/);
  assert.match(calls[0].sql, /program_json\s*->\s*'external_awards'/);
  assert.match(calls[0].sql, /\|\|/);
  assert.equal(calls[0].params[2].pos_integration, undefined);
  assert.equal(calls[0].params[2].external_awards, undefined);
  assert.equal(program.pos_integration.loyverse.access_token, "sandbox-pos-secret");
});

test("repository defaults preserve both integrations for existing campaign callers", async () => {
  const calls = [];
  await runWithDbContext({ client: { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql.startsWith("SELECT") ? [structuredClone(business)] : [] };
  } } }, () => BusinessRepo.updateProgram("biz-1", { program_type: "SPEND", program_json: program }));
  assert.match(calls[0].sql, /program_json\s*->\s*'pos_integration'/);
  assert.match(calls[0].sql, /program_json\s*->\s*'external_awards'/);
  assert.deepEqual(calls[0].params[2], { points_per_q: 1 });
});

test("explicit external-setting updates still cannot replace POS synchronization state", async () => {
  const calls = [];
  await runWithDbContext({ client: { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql.startsWith("SELECT") ? [structuredClone(business)] : [] };
  } } }, () => BusinessRepo.updateProgram("biz-1", {
    program_type: "SPEND", program_json: program, preserveIntegrations: false
  }));
  assert.match(calls[0].sql, /program_json\s*->\s*'pos_integration'/);
  assert.doesNotMatch(calls[0].sql, /program_json\s*->\s*'external_awards'/);
  assert.equal(calls[0].params[2].pos_integration, undefined);
  assert.equal(calls[0].params[2].external_awards.enabled, true);
  assert.match(calls[0].params[2].external_awards.api_key, /^enc:v2:/);
});

test("omitting a legacy API key never rewrites a key rotated after the settings read", async t => {
  const calls = [];
  t.mock.method(BusinessRepo, "getById", async () => structuredClone(business));
  await runWithDbContext({ client: { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 1 };
  } } }, () => runHandler(adminRoutes, "/admin/external-awards", "put", {
    tenantId: "biz-1", body: { enabled: true }
  }));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ["biz-1", { enabled: true }]);
  assert.match(calls[0].sql, /jsonb_set/);
  assert.match(calls[0].sql, /program_json\s*->\s*'external_awards'/);
  assert.match(calls[0].sql, /WHERE id=\$1/);
});

test("legacy external-settings endpoint explicitly permits its credential update", async t => {
  /** @type {Record<string, any>} */
  let update = {};
  t.mock.method(BusinessRepo, "getById", async () => structuredClone(business));
  t.mock.method(BusinessRepo, "updateExternalAwards", async (_id, input) => {
    update = input;
    return structuredClone(business);
  });
  const res = await runHandler(adminRoutes, "/admin/external-awards", "put", {
    tenantId: "biz-1", body: { enabled: true, api_key: "sandbox-owner-replacement" }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(update, { enabled: true, api_key: "sandbox-owner-replacement" });
  assert.equal(res.body.external_awards.api_key, undefined);
});

test("public business repository removes integration data before returning it", async () => {
  const result = await runWithDbContext({ client: { query: async () => ({ rows: [structuredClone(business)] }) } },
    () => BusinessRepo.getPublicBySlug("shop"));
  assert.deepEqual(result.program_json, { points_per_q: 1, external_awards: { enabled: true } });
});

test("repository rotation detects a POS token even when there is no external award key", async () => {
  const updates = [];
  const rotated = await runWithDbContext({ client: { query: async (sql, params) => {
    if (sql.startsWith("SELECT")) return { rows: [{ items: [{ id: "biz-1", program_json: { pos_integration: program.pos_integration } }] }] };
    updates.push(params);
    return { rows: [], rowCount: 1 };
  } } }, () => BusinessRepo.rotateExternalAwardApiKeysToCurrent());
  assert.equal(rotated, 1);
  assert.equal(updates.length, 1);
  assert.match(updates[0][1].pos_integration.loyverse.access_token, /^enc:v2:/);
});

test('legacy template applies only its patch without re-submitting a stale whole program',async t=>{
  t.mock.method(BusinessRepo,'getById',async()=>structuredClone({...business,program_json:{...program,lifecycle:{birthday_monthly_points_cap:100,minimum_contact_days:14}}}));
  t.mock.method(BusinessRepo,'updateProgram',async()=>assert.fail('Template must not replace a previously read program snapshot'));
  t.mock.method(BusinessRepo,'updateLifecycle',async(_id,patch)=>{assert.equal(patch.birthday_monthly_points_cap,undefined);assert.equal(patch.minimum_contact_days,undefined);assert.equal(patch.birthday_points,50);return structuredClone(business);});
  t.mock.method(AuditRepo,'log',async()=>{});
  t.mock.method(PlanConfigService,'getPlanFeatureOverrides',async()=>({}));
  const res=await runHandler(adminRoutes,'/admin/automations/template','put',{tenantId:'biz-1',staff:{role:'OWNER'},body:{template:'cafeteria_basico'}});
  assert.equal(res.statusCode,200);
});
