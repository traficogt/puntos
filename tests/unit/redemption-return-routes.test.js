import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from '../../src/app/database.js';
import { config } from '../../src/config/index.js';
import { requireStaff } from '../../src/middleware/auth.js';
import { requirePlanFeature } from '../../src/middleware/plan-feature.js';
import { tenantContext } from '../../src/middleware/tenant.js';
import { errorHandler } from '../../src/middleware/common.js';
import { StaffRepo } from '../../src/app/repositories/staff-repository.js';
import { BusinessRepo } from '../../src/app/repositories/business-repository.js';
import { PlanConfigService } from '../../src/app/services/plan-config-service.js';
import { createBrowserSession } from '../../src/app/services/auth-session-service.js';

const businessId = randomUUID(), staffId = randomUUID(), branchId = randomUUID();
const originals = { staff: StaffRepo.getById, business: BusinessRepo.getById, plans: PlanConfigService.getPlanFeatureOverrides, query: pool.query };
let role, plan, queries, server, origin, cookie;
before(async () => {
  const route = new URL('../../src/app/routes/analytics/redemption-returns.js', import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository module URL.
  assert.ok(existsSync(route), 'Owner redemption return endpoint must exist');
  const { analyticsRedemptionReturnRoutes } = await import(route.href);
  StaffRepo.getById = async () => ({ id: staffId, business_id: businessId, role, branch_id: null, active: true });
  BusinessRepo.getById = async () => ({ id: businessId, plan });
  PlanConfigService.getPlanFeatureOverrides = async () => ({});
  pool.query = /** @type {any} */ (async (sql, params) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes('FROM branches')) return { rows: params[0] === branchId ? [{ id: branchId }] : [] };
    if (String(sql).includes('FROM businesses')) return { rows: [{ program_json: {} }] };
    return { rows: [{ start_at: '2026-08-14T06:00:00Z', end_at: '2026-11-11T18:00:00Z', customers: '0', legacy_timestamp_customers: '0', completed: { customers: 0, returned_customers: 0, without_return_customers: 0, return_rate_pct: null }, ongoing: { customers: 0, returned_customers: 0 } }] };
  });
  const session = await createBrowserSession({ actorType: 'STAFF', actorId: staffId, businessId, role: 'OWNER' });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}`;
  const app = express();
  app.use(cookieParser());
  // Same shared gates as analytics-routes.js, independent of mount timing.
  app.use('/api/admin/analytics', requireStaff, tenantContext, requirePlanFeature('analytics'));
  app.use('/api', analyticsRedemptionReturnRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { role = 'OWNER'; plan = 'EMPRESA'; queries = []; });
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  StaffRepo.getById = originals.staff;
  BusinessRepo.getById = originals.business;
  PlanConfigService.getPlanFeatureOverrides = originals.plans;
  pool.query = originals.query;
});
async function request(query = '', authenticated = true) {
  const response = await fetch(`${origin}/api/admin/analytics/redemption-returns${query}`, { headers: authenticated ? { cookie } : {} });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}
describe('owner-only redemption return analytics route', () => {
  it('requires staff authentication and rejects every non-owner role before querying', async () => {
    assert.equal((await request('', false)).status, 401);
    for (const value of ['CASHIER', 'MANAGER']) { role = value; assert.equal((await request()).status, 403); }
    assert.equal(queries.length, 0);
  });
  it('preserves the analytics plan gate', async () => {
    plan = 'EMPRENDEDOR';
    const out = await request();
    assert.equal(out.status, 403);
    assert.equal(out.body.code, 'PLAN_FEATURE_LOCKED');
    assert.equal(queries.length, 0);
  });
  it('defaults to 90 days and scopes to the authenticated tenant with an uncached response', async () => {
    const out = await request();
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.deepEqual(out.body.scope, { branch_id: null });
    assert.deepEqual(queries.at(-1).params.slice(0, 4), [businessId, null, 90, 'America/Guatemala']);
    assert.match(out.cache, /no-store/);
  });
  it('accepts supported periods and validates and normalizes branch ownership', async () => {
    for (const days of [7, 30, 90]) {
      assert.equal((await request(`?days=${days}&branch_id=${branchId.toUpperCase()}`)).status, 200);
      assert.deepEqual(queries.at(-1).params.slice(0, 3), [businessId, branchId, days]);
    }
    assert.deepEqual(queries.find(q => q.sql.includes('FROM branches')).params, [branchId, businessId]);
    assert.equal((await request(`?branch_id=${randomUUID()}`)).status, 400);
  });
  it('rejects duplicate, malformed, nested and unknown filters before data access', async () => {
    for (const query of ['?days=0', '?days=365', '?days=7.0', '?days=07', '?days=7x', '?days=', '?days=7&days=30', '?days[x]=7', '?branch_id=invalid', '?branch_id=', `?branch_id=${branchId}&branch_id=${branchId}`, '?branch_id[x]=anything', '?business_id=anything']) {
      assert.equal((await request(query)).status, 400, query);
    }
    assert.equal(queries.length, 0);
  });
});
