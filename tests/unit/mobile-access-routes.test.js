import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMobileRoutes } from '../../src/app/routes/mobile-routes.js';
import { csrfInit } from '../../src/middleware/csrf.js';
import { errorHandler } from '../../src/middleware/common.js';
import { rateLimitByPhone, rateLimitByIp } from '../../src/middleware/rate-limit.js';
const noop = (_req, _res, next) => next();
const businessId = '22222222-2222-4222-8222-222222222222';
async function fixture(t, overrides = {}, useDefaultPhoneLimits = false) {
  const calls = [];
  const service = {
    requestCode: async input => { calls.push(['requestCode', input]); return { ok: true }; },
    verify: async input => { calls.push(['verify', input]); return { status: 'no_cards' }; },
    select: async input => { calls.push(['select', input]); return { status: 'signed_in', token: 'opaque', expiresAt: '2026-12-01T00:00:00.000Z', customer: { id: 'customer-a' }, business: { id: businessId } }; }
  };
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(csrfInit);
  app.use('/api', createMobileRoutes({ accessService: service, accessRequestLimit: noop, accessVerifyLimit: noop, accessSelectLimit: noop, ...(useDefaultPhoneLimits ? {} : { accessRequestPhoneLimit: noop, accessVerifyPhoneLimit: noop }), ...overrides }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, request: (path, body, headers = {}) => fetch(`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/api/mobile/access/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}
function privateResponse(res) { assert.equal(res.headers.get('cache-control'), 'private, no-store'); assert.equal(res.headers.get('set-cookie'), null); }
test('global mobile endpoints accept explicit proof only, strip tenant and email input, and use no cookies', async t => {
  const f = await fixture(t);
  const headers = { 'x-business-id': businessId, cookie: 'pf_customer=ignored' };
  const request = await f.request('request-code', { phone: '+502 5555-1234', email: 'ignored@example.invalid', businessId }, headers);
  assert.equal(request.status, 200); privateResponse(request); assert.deepEqual(await request.json(), { ok: true });
  const verified = await f.request('verify', { phone: '55551234', code: '123456', businessId }, headers);
  assert.equal(verified.status, 200); privateResponse(verified); assert.deepEqual(await verified.json(), { status: 'no_cards' });
  const selected = await f.request('select', { accessToken: 'A'.repeat(43), businessId, phone: '99999999' }, headers);
  assert.equal(selected.status, 200); privateResponse(selected); assert.equal((await selected.json()).status, 'signed_in');
  assert.deepEqual(f.calls, [['requestCode', { phone: '50255551234' }], ['verify', { phone: '50255551234', code: '123456' }], ['select', { accessToken: 'A'.repeat(43), businessId }]]);
});
test('invalid proof input fails validation before calling the global service', async t => {
  const f = await fixture(t);
  for (const [path, body] of [['request-code', {}], ['request-code', { phone: 'letters' }], ['request-code', { phone: '55551234abc' }], ['request-code', { phone: '1234567' }], ['verify', { phone: '55551234', code: '12345' }], ['verify', { phone: '55551234', code: 'abcdef' }], ['verify', { phone: '55551234', code: '123' }], ['select', { businessId }], ['select', { accessToken: 'A'.repeat(43), businessId: 'invalid' }]]) {
    const res = await f.request(path, body); assert.equal(res.status, 400); privateResponse(res);
  }
  assert.deepEqual(f.calls, []);
});
test('global OTP request limits share normalized phone formats', async t => {
  const f = await fixture(t, { accessRequestPhoneLimit: rateLimitByPhone(1, 60000) });
  assert.equal((await f.request('request-code', { phone: '5555-7891' })).status, 200);
  assert.equal((await f.request('request-code', { phone: '+50255557891' })).status, 429);
  assert.equal(f.calls.length, 1);
});
test('global request, verification and selection each have an IP limiter', async t => {
  for (const [path, key, body] of [['request-code', 'accessRequestLimit', { phone: '55551234' }], ['verify', 'accessVerifyLimit', { phone: '55551234', code: '123456' }], ['select', 'accessSelectLimit', { accessToken: 'A'.repeat(43), businessId }]]) {
    const f = await fixture(t, { [String(key)]: rateLimitByIp(1, 60000, { keyPrefix: `test:mobile-access:${path}:` }) });
    assert.equal((await f.request(path, body)).status, 200);
    const denied = await f.request(path, body); assert.equal(denied.status, 429); privateResponse(denied);
    assert.equal(f.calls.length, 1);
  }
});

test('actual access request and verification buckets stay separate from each other and legacy login/join', async t => {
  const f = await fixture(t, {
    BusinessRepo: { getPublicBySlug: async () => ({ id: businessId }) },
    setTenantForRequest: async () => {}, requestCodeLimit: noop,
    requestJoinCode: async () => ({ ok: true })
  }, true);
  const phone = index => index % 2 ? '+502 5555-9812' : '55559812';
  for (let i = 0; i < 10; i++) assert.equal((await f.request('verify', { phone: phone(i), code: '123456' })).status, 200);
  assert.equal((await f.request('verify', { phone: phone(10), code: '123456' })).status, 429);
  for (let i = 0; i < 5; i++) assert.equal((await f.request('request-code', { phone: phone(i) })).status, 200);
  assert.equal((await f.request('request-code', { phone: phone(5) })).status, 429);
  for (let i = 0; i < 3; i++) assert.equal((await f.request(`../business/cafe/${i % 2 ? 'join' : 'login'}/request-code`, { phone: phone(i) })).status, 200);
  assert.equal((await f.request('../business/cafe/login/request-code', { phone: phone(3) })).status, 429);
});
