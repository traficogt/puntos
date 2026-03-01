import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tenantContext } from "../../src/middleware/tenant.js";
import { runWithDbContext } from "../../src/app/database.js";

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.status = (code) => { res.statusCode = code; return res; };
  res.jsonBody = null;
  res.json = (body) => { res.jsonBody = body; return res; };
  return res;
}

describe("tenantContext middleware", () => {
  it("sets tenant from staff context and calls next", async () => {
    let called = false;
    const req = { staff: { business_id: "biz-1" } };
    const res = mockRes();
    tenantContext(req, res, () => { called = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(req.tenantId, "biz-1");
    assert.deepEqual(req.tenant, { id: "biz-1" });
    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
  });

	it("sets tenant from customerAuth context", async () => {
    let called = false;
    const req = { customerAuth: { business_id: "biz-c" } };
    const res = mockRes();
    tenantContext(req, res, () => { called = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(req.tenantId, "biz-c");
    assert.deepEqual(req.tenant, { id: "biz-c" });
    assert.equal(called, true);
	});

	it("returns 400 when tenant context is missing and enforcement enabled", () => {
	  let called = false;
	  const req = {};
	  const res = mockRes();
    tenantContext(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody?.code, "TENANT_REQUIRED");
	});

	it("sets Postgres GUC when pgClient is present", async () => {
	  let called = false;
	  let queryArgs = null;
	  const pgClient = {
	    query: (...args) => { queryArgs = args; return Promise.resolve(); }
	  };
	  const req = { staff: { business_id: "biz-guc" }, pgClient };
	  const res = mockRes();
	  runWithDbContext({ client: pgClient, tenantId: null }, () => {
	    tenantContext(req, res, () => { called = true; });
	  });
	  // allow async resolution of the query promise
	  await new Promise((resolve) => setImmediate(resolve));
	  assert.equal(called, true);
	  assert.ok(queryArgs, "pgClient.query should be called");
	  assert.equal(queryArgs[0], "SELECT set_config('app.current_tenant', $1, $2)");
	  assert.deepEqual(queryArgs[1], ["biz-guc", false]);
	});
  });
