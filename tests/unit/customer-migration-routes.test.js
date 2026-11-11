import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../../src/middleware/common.js';
import { SecurityEventRepo } from '../../src/app/repositories/security-event-repository.js';
import * as routes from '../../src/app/routes/admin/customer-migration-routes.js';
const businessId = randomUUID(), staffId = randomUUID(), requestId = randomUUID();
const body = { csv: 'Teléfono\n55550001', columns: { phone: 'Teléfono' }, existing_policy: 'skip', request_id: requestId, label: 'Anterior', confirmed: true };
let server, origin, calls = [];
before(async () => {
  if (!routes.createCustomerMigrationRoutes) return;
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api', routes.createCustomerMigrationRoutes({
    staffAuth: (req, res, next) => { if (!req.get('x-role')) return res.sendStatus(401); req.staff = { id: staffId, business_id: businessId, role: req.get('x-role'), impersonated_by: 'authenticated-support@example.test' }; next(); },
    service: /** @type {any} */ ({
      previewCustomerMigration: async input => { calls.push(input); return { headers: ['Teléfono'], rows: [], can_commit: false }; },
      commitCustomerMigration: async input => { calls.push(input); return { batch: { id: requestId } }; },
      listCustomerMigrations: async input => { calls.push(input); return { batches: [] }; }
    })
  }));
  app.use(errorHandler); server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
/** @param {string} suffix @param {{method?: string, payload?: any, role?: string, token?: string, requestOrigin?: string}} [options] */
async function request(suffix, { method = 'GET', payload, role = 'OWNER', token = 'test-csrf', requestOrigin = origin } = {}) {
  assert.equal(typeof routes.createCustomerMigrationRoutes, 'function', 'Owner migration routes must exist');
  return fetch(`${origin}/api/admin/customer-migrations${suffix}`, { method, headers: { 'content-type': 'application/json', 'x-role': role, cookie: 'pf_csrf=test-csrf', 'x-csrf-token': token, origin: requestOrigin }, body: payload === undefined ? undefined : JSON.stringify(payload) });
}
test('migration endpoints all require authenticated owner and private no-store responses', async () => {
  for (const operation of [{ suffix: '' }, { suffix: '/template' }, { suffix: '/preview', method: 'POST', payload: { csv: body.csv } }, { suffix: '/commit', method: 'POST', payload: body }]) {
    for (const role of ['', 'CASHIER']) {
      const res = await request(operation.suffix, { ...operation, role });
      assert.equal(res.status, role ? 403 : 401); assert.match(res.headers.get('cache-control'), /no-store/);
    }
  }
});
test('owner commits use session tenant and actor and require explicit confirmation and valid CSRF', async t => {
  t.mock.method(SecurityEventRepo, 'log', async () => {});
  calls = [];
  for (const extra of [{ token: '' }, { token: 'wrong' }, { requestOrigin: 'https://untrusted.invalid' }]) assert.equal((await request('/commit', { method: 'POST', payload: body, ...extra })).status, 403);
  for (const extra of [{ confirmed: false }, { confirmed: undefined }, { business_id: randomUUID() }, { opening_points: 999 }, { request_id: 'bad' }, { label: '' }, { impersonated_by: 'forged@example.test' }]) assert.equal((await request('/commit', { method: 'POST', payload: { ...body, ...extra } })).status, 400);
  assert.equal(calls.length, 0);
  const response = await request('/commit', { method: 'POST', payload: body });
  assert.equal(response.status, 201);
  assert.equal(calls[0].businessId, businessId); assert.equal(calls[0].staffId, staffId);
  assert.equal(calls[0].confirmed, true);
  assert.equal(calls[0].impersonated_by, 'authenticated-support@example.test');
});
test('preview accepts inspection then mapping but rejects caller filters and metadata; template downloads safely', async () => {
  assert.equal((await request('/preview', { method: 'POST', payload: { csv: body.csv } })).status, 200);
  assert.equal((await request('/preview', { method: 'POST', payload: { csv: body.csv, columns: body.columns } })).status, 200);
  assert.equal((await request('/preview?business_id=other', { method: 'POST', payload: { csv: body.csv } })).status, 400);
  assert.equal((await request('?limit=100000')).status, 400);
  const template = await request('/template');
  assert.equal(template.status, 200); assert.match(template.headers.get('content-disposition'), /attachment/);
  assert.match(await template.text(), /Teléfono,Nombre,Saldo/);
});
