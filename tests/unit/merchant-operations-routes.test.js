import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { before, beforeEach, after, it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMerchantOperationsRoutes } from '../../src/app/routes/merchant-operations-routes.js';
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
  router = createMerchantOperationsRoutes({ getOperationsHealth: async input => {
    calls.push(input);
    if (handlerError) throw handlerError;
    return { generated_at: '2026-11-10T18:00:00.000Z', sections: [] };
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
async function request({ cookie = staffCookie, query = '', body = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${origin}/api/admin/operations-health${query}`, {
      method: 'GET', headers: { cookie, ...(data === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }) }
    }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, cache: res.headers['cache-control'], body: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(data);
  });
}

it('wires real staff, owner and tenant guards without locking the whole diagnostics route by plan', () => {
  const route = router.stack.find(layer => layer.route?.path === '/admin/operations-health').route;
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

it('binds service access to the owner session tenant and accepts no client query or body', async () => {
  for (const options of [
    { query: '?business_id=other-tenant' }, { query: '?unknown=1' }, { query: '?business_id=a&business_id=b' },
    { body: {} }, { body: { business_id: randomUUID() } }, { body: [] }
  ]) {
    const response = await request(options); assert.equal(response.status, 400, JSON.stringify(options)); assert.equal(response.cache, 'no-store');
  }
  assert.equal(calls.length, 0);
  const response = await request(); assert.equal(response.status, 200); assert.equal(response.cache, 'no-store');
  assert.deepEqual(calls, [{ businessId }]);
});

it('returns a safe unavailable response for genuine database failure instead of raw errors or success', async () => {
  handlerError = Object.assign(new Error('private database error contains a credential'), { code: 'PRIVATE_INTERNAL_CODE' });
  const response = await request();
  assert.equal(response.status, 503); assert.equal(response.cache, 'no-store');
  assert.equal(response.body.code, 'OPERATIONS_UNAVAILABLE');
  assert.equal(JSON.stringify(response.body).includes('private'), false);
  assert.equal(JSON.stringify(response.body).includes('PRIVATE_INTERNAL_CODE'), false);
  assert.equal(response.body.sections, undefined);
});
