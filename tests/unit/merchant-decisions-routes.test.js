import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { before, beforeEach, after, it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMerchantDecisionsRoutes } from '../../src/app/routes/merchant-decisions-routes.js';
import { config } from '../../src/config/index.js';
import { StaffRepo } from '../../src/app/repositories/staff-repository.js';
import { SecurityEventRepo } from '../../src/app/repositories/security-event-repository.js';
import { createBrowserSession } from '../../src/app/services/auth-session-service.js';
import { errorHandler } from '../../src/middleware/common.js';
import { conflict } from '../../src/utils/http-error.js';

const businessId = randomUUID(), otherBusiness = randomUUID(), staffId = randomUUID(), otherStaff = randomUUID();
const base = '/api/admin/decisions', csrf = 'fixture-decisions-csrf';
const review = { decision_key: 'operation-apple_wallet', fingerprint: 'a'.repeat(64), version: 0, status: 'reviewed' };
const mode = { mode: 'busy', minutes: 120, version: 'b'.repeat(64) };
const operations = [{ path: '', method: 'GET' }, { path: '/review', method: 'POST', body: review }, { path: '/operating-mode', method: 'POST', body: mode }];
let server, origin, ownerCookie, otherCookie, customerCookie, impersonatedCookie, role, calls, handlerError;
const original = { staff: StaffRepo.getById, security: SecurityEventRepo.log };

before(async () => {
  StaffRepo.getById = async id => ({ id, business_id: id === otherStaff ? otherBusiness : businessId, role, active: true });
  SecurityEventRepo.log = async () => {};
  const owner = await createBrowserSession({ actorType: 'STAFF', actorId: staffId, businessId, role: 'OWNER' });
  const other = await createBrowserSession({ actorType: 'STAFF', actorId: otherStaff, businessId: otherBusiness, role: 'OWNER' });
  const customer = await createBrowserSession({ actorType: 'CUSTOMER', actorId: randomUUID(), businessId });
  const impersonated = await createBrowserSession({ actorType: 'STAFF', actorId: staffId, businessId, role: 'OWNER', impersonatedBy: 'support@example.invalid' });
  ownerCookie = `${config.STAFF_COOKIE_NAME}=${owner.token}; pf_csrf=${csrf}`;
  otherCookie = `${config.STAFF_COOKIE_NAME}=${other.token}; pf_csrf=${csrf}`;
  customerCookie = `${config.CUSTOMER_COOKIE_NAME}=${customer.token}; pf_csrf=${csrf}`;
  impersonatedCookie = `${config.STAFF_COOKIE_NAME}=${impersonated.token}; pf_csrf=${csrf}`;
  const handler = kind => async input => {
    calls.push({ kind, input });
    if (handlerError) throw handlerError;
    return { ok: true };
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api', createMerchantDecisionsRoutes({ getDecisionInbox: handler('get'), reviewDecision: handler('review'), setOperatingMode: handler('mode') }));
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { role = 'OWNER'; calls = []; handlerError = null; });
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  StaffRepo.getById = original.staff; SecurityEventRepo.log = original.security;
});

/** @returns {Promise<{status:number,body:any,cache:string|string[],referrer:string|string[]}>} */
async function request(path = '', { method = 'GET', body = undefined, cookie = ownerCookie, token = csrf, requestOrigin = origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${origin}${base}${path}`, {
      method, headers: {
        cookie, origin: requestOrigin, 'x-csrf-token': token, 'User-Agent': 'decisions-route-test',
        ...(data === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) })
      }
    }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text), cache: res.headers['cache-control'], referrer: res.headers['referrer-policy'] }));
    });
    req.on('error', reject); req.end(data);
  });
}

it('denies anonymous, customer, cashier and manager sessions before every decision service', async () => {
  for (const cookie of ['', customerCookie]) for (const op of operations) {
    const response = await request(op.path, { ...op, cookie });
    assert.equal(response.status, 401); assert.equal(response.cache, 'no-store'); assert.equal(response.referrer, 'no-referrer');
  }
  for (const value of ['CASHIER', 'MANAGER']) {
    role = value;
    for (const op of operations) {
      const response = await request(op.path, op);
      assert.equal(response.status, 403); assert.equal(response.cache, 'no-store');
    }
  }
  assert.equal(calls.length, 0);
});

it('reads only the session tenant and rejects client-selected tenants and nonempty GET bodies', async () => {
  for (const path of ['?business_id=other', '?unknown=1', '?business_id=a&business_id=b', '?business_id[x]=other']) {
    const response = await request(path);
    assert.equal(response.status, 400, path); assert.equal(response.cache, 'no-store');
  }
  for (const body of [{ business_id: otherBusiness }, { staff_id: otherStaff }, []]) assert.equal((await request('', { body })).status, 400);
  assert.equal(calls.length, 0);
  for (const [cookie, tenant] of [[ownerCookie, businessId], [otherCookie, otherBusiness]]) {
    const response = await request('', { cookie });
    assert.equal(response.status, 200); assert.equal(response.cache, 'no-store'); assert.equal(response.referrer, 'no-referrer');
    assert.deepEqual(calls.at(-1), { kind: 'get', input: { businessId: tenant } });
  }
});

it('requires matching CSRF token, cookie and request origin on both mutations', async () => {
  for (const op of operations.filter(value => value.method === 'POST')) {
    for (const change of [{ token: '' }, { token: 'wrong' }, { cookie: ownerCookie.split(';')[0] }, { requestOrigin: '' }, { requestOrigin: 'https://unrelated.invalid' }]) {
      const response = await request(op.path, { ...op, ...change });
      assert.equal(response.status, 403); assert.equal(response.cache, 'no-store');
    }
  }
  assert.equal(calls.length, 0);
});

it('accepts Wallet review keys and bounded pause values with authenticated actor attribution', async () => {
  for (const decision_key of ['operation-apple_wallet', 'operation-google_wallet']) {
    const input = { ...review, decision_key };
    assert.equal((await request('/review', { method: 'POST', body: input, cookie: otherCookie })).status, 200);
    assert.deepEqual(calls.at(-1), { kind: 'review', input: { businessId: otherBusiness, staffId: otherStaff, ip: '127.0.0.1', ua: 'decisions-route-test', impersonated_by: null, input } });
  }
  for (const snooze_hours of [1, 4, 24]) {
    const input = { ...review, status: 'snoozed', snooze_hours, version: 1 };
    assert.equal((await request('/review', { method: 'POST', body: input })).status, 200);
    assert.deepEqual(calls.at(-1).input.input, input);
  }
  for (const input of [{ ...review, status: 'open', version: 2 }, mode, { mode: 'normal', version: mode.version }]) {
    const path = 'mode' in input ? '/operating-mode' : '/review';
    const response = await request(path, { method: 'POST', body: input, cookie: impersonatedCookie });
    assert.equal(response.status, 200); assert.equal(response.cache, 'no-store');
    assert.deepEqual(calls.at(-1).input, { businessId, staffId, ip: '127.0.0.1', ua: 'decisions-route-test', impersonated_by: 'support@example.invalid', input });
  }
});

it('strictly validates review evidence, versions, statuses and snooze bounds before service access', async () => {
  const invalid = [
    {}, { ...review, decision_key: '' }, { ...review, decision_key: 'Operation-Wallet' }, { ...review, decision_key: 'a'.repeat(81) },
    { ...review, fingerprint: 'a'.repeat(63) }, { ...review, fingerprint: 'g'.repeat(64) },
    { ...review, version: -1 }, { ...review, version: 0.5 }, { ...review, version: '0' }, { ...review, version: 2147483647 },
    { ...review, status: 'resolved' }, { ...review, status: 'snoozed' }, { ...review, status: 'snoozed', snooze_hours: 2 },
    { ...review, status: 'snoozed', snooze_hours: '1' }, { ...review, snooze_hours: 1 },
    { ...review, business_id: otherBusiness }, { ...review, staff_id: otherStaff }, { ...review, impersonated_by: 'client' }
  ];
  for (const body of invalid) {
    const response = await request('/review', { method: 'POST', body });
    assert.equal(response.status, 400, JSON.stringify(body)); assert.equal(response.body.code, 'VALIDATION_ERROR'); assert.equal(response.cache, 'no-store');
  }
  assert.equal((await request('/review?business_id=other', { method: 'POST', body: review })).status, 400);
  assert.equal(calls.length, 0);
});

it('strictly validates operating modes, bounded durations and concurrency tokens before service access', async () => {
  const invalid = [
    {}, { ...mode, mode: 'quiet' }, { mode: 'busy', version: mode.version },
    { ...mode, minutes: 0 }, { ...mode, minutes: 31 }, { ...mode, minutes: 241 }, { ...mode, minutes: '120' },
    { ...mode, mode: 'normal' }, { ...mode, version: 1 }, { ...mode, version: 'b'.repeat(63) },
    { ...mode, business_id: otherBusiness }, { ...mode, staff_id: otherStaff }, { ...mode, until: '2030-01-01T00:00:00Z' }
  ];
  for (const body of invalid) {
    const response = await request('/operating-mode', { method: 'POST', body });
    assert.equal(response.status, 400, JSON.stringify(body)); assert.equal(response.body.code, 'VALIDATION_ERROR'); assert.equal(response.cache, 'no-store');
  }
  assert.equal((await request('/operating-mode?version=other', { method: 'POST', body: mode })).status, 400);
  assert.equal(calls.length, 0);
});

it('preserves optimistic concurrency conflicts and no-store on both mutation responses', async () => {
  handlerError = conflict('Otra sesión cambió el estado.');
  for (const op of operations.filter(value => value.method === 'POST')) {
    const response = await request(op.path, op);
    assert.equal(response.status, 409); assert.equal(response.cache, 'no-store');
    assert.equal(response.body.error, 'Otra sesión cambió el estado.');
  }
});
