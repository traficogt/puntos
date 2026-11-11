import assert from 'node:assert/strict';
import test from 'node:test';
import { customerRoutes } from '../../src/app/routes/customer-routes.js';
import { requireCustomer } from '../../src/middleware/auth.js';
import { tenantContext } from '../../src/middleware/tenant.js';
import { runWithDbContext } from '../../src/app/database.js';

const route = customerRoutes.stack.find(layer => layer.route?.path === '/customer/statement').route;
const handler = route.stack.at(-1).handle;
async function call(extra = {}, row = null) {
  const queries = [];
  const req = /** @type {any} */ ({ query: {}, customerAuth: { id: 'customer-a', business_id: 'business-a' }, tenantId: 'business-a', ...extra });
  const response = { status: 200, headers: {}, body: null };
  const res = /** @type {any} */ ({ setHeader(k, v) { response.headers[k] = v; }, status(code) { response.status = code; return this; }, json(body) { response.body = body; return this; }, clearCookie() {} });
  await runWithDbContext({ client: { query: async (sql, params) => { queries.push({ sql, params }); return { rows: row ? [row] : [] }; } } }, () => handler(req, res, err => { throw err; }));
  return { ...response, queries };
}
test('statement route requires customer authentication and tenant context', () => {
  assert.equal(route.stack[0].handle, requireCustomer);
  assert.equal(route.stack[1].handle, tenantContext);
});
test('statement refuses supplied identities and tenant mismatch before reading data', async () => {
  for (const query of [{ customer_id: 'other' }, { business_id: 'other' }, { days: '999' }]) {
    const response = await call({ query });
    assert.equal(response.status, 400);
    assert.equal(response.queries.length, 0);
  }
  const response = await call({ tenantId: 'other' });
  assert.equal(response.status, 404);
  assert.equal(response.queries.length, 0);
});
test('statement selects only the authenticated customer, is not HTTP-cacheable and handles deleted accounts', async () => {
  const row = { end_at: '2026-11-11T12:00:00Z', start_at: '2026-10-12T12:00:00Z', available: 20, pending: 5, earned: 20, redeemed: 0, expired: 0, adjustments: 0, rewards: 0, private_key: 'must-not-leak' };
  const response = await call({}, row);
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(response.queries[0].params, ['business-a', 'customer-a', null]);
  assert.equal(response.body.statement.points.earned, 20);
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak/);
  assert.equal((await call()).status, 404);
});
