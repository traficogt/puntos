import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { before, beforeEach, after, it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as module from '../../src/app/routes/transaction-explanation-routes.js';
import { config } from '../../src/config/index.js';
import { StaffRepo } from '../../src/app/repositories/staff-repository.js';
import { createBrowserSession } from '../../src/app/services/auth-session-service.js';
import { requireStaff, requireOwner } from '../../src/middleware/auth.js';
import { tenantContext } from '../../src/middleware/tenant.js';
import { errorHandler } from '../../src/middleware/common.js';

const businessId = randomUUID(), staffId = randomUUID();
let origin, server, staffCookie, customerCookie, role, calls, handlerError, router;
const originalStaff = StaffRepo.getById;
before(async () => {
  StaffRepo.getById = async () => ({ id: staffId, business_id: businessId, active: true, role });
  const staff = await createBrowserSession({ actorType: 'STAFF', actorId: staffId, businessId, role: 'OWNER' });
  const customer = await createBrowserSession({ actorType: 'CUSTOMER', actorId: randomUUID(), businessId });
  staffCookie = `${config.STAFF_COOKIE_NAME}=${staff.token}`;
  customerCookie = `${config.CUSTOMER_COOKIE_NAME}=${customer.token}`;
  assert.equal(typeof module.createTransactionExplanationRoutes, 'function', 'owner history routes must exist');
  router = module.createTransactionExplanationRoutes({ listTransactionHistory: async input => {
    calls.push(input);
    if (handlerError) throw handlerError;
    return { movements: [], next_cursor: null };
  }, getTransactionExplanation: async input => { calls.push(input); if (handlerError) throw handlerError; return { movement: { id: input.id } };
  } });
  const app = express();
  app.use(express.json(), cookieParser()); app.use('/api', router); app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { role = 'OWNER'; calls = []; handlerError = null; });
after(async () => { await new Promise(resolve => server?.close(resolve)); StaffRepo.getById = originalStaff; });
async function request({ cookie = staffCookie, query = '', id = '', body = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${origin}/api/admin/transaction-history${id ? `/${id}` : ""}${query}`, {
      method: 'GET', headers: { cookie, ...(data === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }) }
    }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, cache: res.headers['cache-control'], body: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(data);
  });
}

it('wires real staff, owner and tenant guards without locking the whole diagnostics route by plan', () => {
  const route = router.stack.find(layer => layer.route?.path === '/admin/transaction-history').route;
  const handlers = route.stack.map(entry => entry.handle);
  assert.ok(handlers.includes(requireStaff)); assert.ok(handlers.includes(requireOwner)); assert.ok(handlers.includes(tenantContext));
  assert.equal(handlers.some(handler => handler.__openapi?.planFeatures?.length > 0), false);
});

it('denies anonymous, customer, cashier and manager sessions with no-store before service access', async () => {
  for (const cookie of ['', customerCookie]) {
    const response = await request({ cookie }); assert.equal(response.status, 401); assert.equal(response.cache, 'no-store');
  }
  for (const value of ['CASHIER', 'MANAGER']) {
    role = value; const response = await request(); assert.equal(response.status, 403); assert.equal(response.cache, 'no-store');
  }
  assert.equal(calls.length, 0);
});

it('binds history access to the owner tenant and rejects unknown filters, body and invalid limits', async () => {
  for (const options of [
    { query: '?business_id=other-tenant' }, { query: '?unknown=1' }, { query: '?limit=51' }, { query: '?limit=2&limit=3' }, { query: '?kind=unsafe' }, { query: '?business_id=a&business_id=b' },
    { body: {} }, { body: { business_id: randomUUID() } }, { body: [] }
  ]) {
    const response = await request(options); assert.equal(response.status, 400, JSON.stringify(options)); assert.equal(response.cache, 'no-store');
  }
  assert.equal(calls.length, 0);
  const response = await request(); assert.equal(response.status, 200); assert.equal(response.cache, 'no-store');
  assert.deepEqual(calls, [{ businessId, limit: 25, kind: 'all' }]);
  assert.equal((await request({ query: '?limit=10&kind=refund' })).status, 200);
  assert.deepEqual(calls.at(-1), { businessId, limit: 10, kind: 'refund' });
  assert.equal((await request({ id: 'not-uuid' })).status, 400);
  const id = randomUUID();
  assert.equal((await request({ id })).status, 200);
  assert.deepEqual(calls.at(-1), { businessId, id });
  assert.equal((await request({ id, query: '?business_id=other' })).status, 400);
});

it('returns a safe unavailable response for genuine database failure instead of raw errors or success', async () => {
  handlerError = Object.assign(new Error('private database error contains a credential'), { code: 'PRIVATE_INTERNAL_CODE' });
  const response = await request();
  assert.equal(response.status, 503); assert.equal(response.cache, 'no-store');
  assert.equal(response.body.code, 'TRANSACTION_HISTORY_UNAVAILABLE');
  assert.equal(JSON.stringify(response.body).includes('private'), false);
  assert.equal(JSON.stringify(response.body).includes('PRIVATE_INTERNAL_CODE'), false);
  assert.equal(response.body.movements, undefined);
});

it('accepts bounded staff, source, branch and interval drill-down filters without trusting tenant input', async () => {
  const branch = randomUUID(), start='2026-11-09T06:00:00.000Z', end='2026-11-11T18:00:00.000Z';
  const filters = new URLSearchParams({staff_id:staffId,source_group:'staff',branch_id:branch,start,end});
  assert.equal((await request({query:`?${filters}`})).status,200);
  assert.deepEqual(calls.at(-1),{businessId,limit:25,kind:'all',staff_id:staffId,source_group:'staff',branch_id:branch,start,end});
  for(const query of ['?staff_id=bad','?source_group=fraud','?start=2026-11-09T00:00:00Z','?start=2026-11-10T00:00:00Z&end=2026-11-09T00:00:00Z','?start=2025-01-01T00:00:00Z&end=2026-11-09T00:00:00Z']) assert.equal((await request({query})).status,400);
});
