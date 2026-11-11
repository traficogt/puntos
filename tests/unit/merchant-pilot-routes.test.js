import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMerchantPilotRoutes } from '../../src/app/routes/merchant-pilot-routes.js';
import { config } from '../../src/config/index.js';
import { StaffRepo } from '../../src/app/repositories/staff-repository.js';
import { BusinessRepo } from '../../src/app/repositories/business-repository.js';
import { PlanConfigService } from '../../src/app/services/plan-config-service.js';
import { SecurityEventRepo } from '../../src/app/repositories/security-event-repository.js';
import { createBrowserSession } from '../../src/app/services/auth-session-service.js';
import { errorHandler, notFound as notFoundRoute } from '../../src/middleware/common.js';
import { notFound } from '../../src/utils/http-error.js';

const businessId = randomUUID(), otherBusinessId = randomUUID(), staffId = randomUUID(), otherStaffId = randomUUID();
const pilotId = randomUUID(), otherPilotId = randomUUID(), requestId = randomUUID();
const base = '/api/admin/pilots', csrf = 'fixture-pilot-csrf';
const creation = { request_id: requestId, name: ' Piloto de prueba ', duration_days: 30 };
const evidence = { status: 'passed', note: ' Revisado por el responsable ' };
const closure = { outcome: 'stopped', note: ' Repetir después de corregir ' };
const operations = [
  { path: '', method: 'GET', body: undefined },
  { path: `/${pilotId}`, method: 'GET', body: undefined },
  { path: '', method: 'POST', body: creation },
  { path: `/${pilotId}/checks/purchase`, method: 'PUT', body: evidence },
  { path: `/${pilotId}/close`, method: 'POST', body: closure }
];
let server, origin, ownerCookie, otherOwnerCookie, customerCookie, role, plan, overrides, calls;
const original = {
  staff: StaffRepo.getById, business: BusinessRepo.getById,
  plans: PlanConfigService.getPlanFeatureOverrides, security: SecurityEventRepo.log
};

before(async () => {
  StaffRepo.getById = async id => ({ id, business_id: id === otherStaffId ? otherBusinessId : businessId, role, active: true });
  BusinessRepo.getById = async id => ({ id, plan });
  PlanConfigService.getPlanFeatureOverrides = async () => overrides;
  SecurityEventRepo.log = async () => {};
  const owner = await createBrowserSession({ actorType: 'STAFF', actorId: staffId, businessId, role: 'OWNER' });
  const other = await createBrowserSession({ actorType: 'STAFF', actorId: otherStaffId, businessId: otherBusinessId, role: 'OWNER' });
  const customer = await createBrowserSession({ actorType: 'CUSTOMER', actorId: randomUUID(), businessId });
  ownerCookie = `${config.STAFF_COOKIE_NAME}=${owner.token}; pf_csrf=${csrf}`;
  otherOwnerCookie = `${config.STAFF_COOKIE_NAME}=${other.token}; pf_csrf=${csrf}`;
  customerCookie = `${config.CUSTOMER_COOKIE_NAME}=${customer.token}; pf_csrf=${csrf}`;
  const handler = kind => async input => {
    calls.push({ kind, input });
    const ownedPilot = input.businessId === otherBusinessId ? otherPilotId : pilotId;
    if (input.pilotId && input.pilotId !== ownedPilot) throw notFound('Piloto no encontrado.');
    if (kind === 'list') return { pilots: [{ id: ownedPilot }], total: 1, offset: input.offset, limit: 20 };
    if (kind === 'check') return { ok: true };
    return { pilot: { id: ownedPilot } };
  };
  const app = express(); app.use(express.json(), cookieParser());
  app.use('/api', createMerchantPilotRoutes({
    listPilots: handler('list'), getPilot: handler('detail'), createPilot: handler('create'),
    updatePilotCheck: handler('check'), closePilot: handler('close')
  }));
  app.use(notFoundRoute); app.use(errorHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { role = 'OWNER'; plan = 'NEGOCIO'; overrides = {}; calls = []; });
after(async () => {
  await new Promise(resolve => server?.close(resolve));
  StaffRepo.getById = original.staff; BusinessRepo.getById = original.business;
  PlanConfigService.getPlanFeatureOverrides = original.plans; SecurityEventRepo.log = original.security;
});
async function request(path = '', { method = 'GET', body = undefined, cookie = ownerCookie, token = csrf, requestOrigin = origin } = {}) {
  const response = await fetch(`${origin}${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'pilot-route-test', cookie, origin: requestOrigin, 'x-csrf-token': token },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

it('requires an authenticated owner for every pilot read and mutation, including no-store denials', async () => {
  for (const cookie of ['', customerCookie]) for (const operation of operations) {
    const response = await request(operation.path, { ...operation, cookie });
    assert.equal(response.status, 401, `${operation.method} ${operation.path}`);
    assert.equal(response.cache, 'no-store');
  }
  for (const value of ['CASHIER', 'MANAGER']) {
    role = value;
    for (const operation of operations) {
      const response = await request(operation.path, operation);
      assert.equal(response.status, 403, `${value} ${operation.method} ${operation.path}`);
      assert.equal(response.cache, 'no-store');
    }
  }
  assert.equal(calls.length, 0);
});

it('requires analytics for every pilot endpoint and honors explicit plan overrides', async () => {
  for (const settings of [
    { plan: 'EMPRENDEDOR', overrides: {} },
    { plan: 'NEGOCIO', overrides: { NEGOCIO: { analytics: false } } }
  ]) {
    plan = settings.plan; overrides = settings.overrides;
    for (const operation of operations) {
      const response = await request(operation.path, operation);
      assert.equal(response.status, 403); assert.equal(response.body.code, 'PLAN_FEATURE_LOCKED');
      assert.equal(response.cache, 'no-store');
    }
  }
  assert.equal(calls.length, 0);
  plan = 'EMPRENDEDOR'; overrides = { EMPRENDEDOR: { analytics: true } };
  assert.equal((await request()).status, 200);
  assert.deepEqual(calls[0], { kind: 'list', input: { businessId, offset: 0 } });
});

it('requires CSRF token, CSRF cookie and matching origin on each mutation', async () => {
  for (const operation of operations.filter(value => value.method !== 'GET')) for (const change of [
    { token: '' }, { token: 'incorrect' }, { cookie: ownerCookie.split(';')[0] },
    { requestOrigin: 'https://unrelated.invalid' }, { requestOrigin: '' }
  ]) {
    const response = await request(operation.path, { ...operation, ...change });
    assert.equal(response.status, 403, `${operation.method} ${operation.path} ${JSON.stringify(change)}`);
    assert.equal(response.cache, 'no-store');
  }
  assert.equal(calls.length, 0);
});

it('binds list/detail and mutation arguments to the authenticated tenant and actor', async () => {
  assert.equal((await request('?offset=20')).status, 200);
  assert.deepEqual(calls.at(-1), { kind: 'list', input: { businessId, offset: 20 } });
  assert.equal((await request(`/${pilotId.toUpperCase()}`)).status, 200);
  assert.deepEqual(calls.at(-1), { kind: 'detail', input: { businessId, pilotId } });
  const response = await request('', { method: 'POST', body: { ...creation, request_id: requestId.toUpperCase() } });
  assert.equal(response.status, 201); assert.equal(response.cache, 'no-store');
  assert.deepEqual(calls.at(-1).input, { businessId, staffId, ip: '127.0.0.1', ua: 'pilot-route-test', requestId, name: 'Piloto de prueba', durationDays: 30 });
  assert.equal((await request(`/${pilotId}/checks/purchase`, { method: 'PUT', body: evidence })).status, 200);
  assert.deepEqual(calls.at(-1).input, { businessId, staffId, ip: '127.0.0.1', ua: 'pilot-route-test', pilotId, key: 'purchase', status: 'passed', note: 'Revisado por el responsable' });
  assert.equal((await request(`/${pilotId}/close`, { method: 'POST', body: closure })).status, 200);
  assert.deepEqual(calls.at(-1).input, { businessId, staffId, ip: '127.0.0.1', ua: 'pilot-route-test', pilotId, outcome: 'stopped', note: 'Repetir después de corregir' });
});

it('passes the other owner session tenant through list and never substitutes the pilot owner into detail or mutations', async () => {
  const otherList = await request('', { cookie: otherOwnerCookie });
  assert.equal(otherList.status, 200); assert.deepEqual(otherList.body.pilots, [{ id: otherPilotId }]);
  assert.deepEqual(calls.at(-1).input, { businessId: otherBusinessId, offset: 0 });
  assert.equal((await request(`/${otherPilotId}`, { cookie: otherOwnerCookie })).status, 200);
  assert.deepEqual(calls.at(-1).input, { businessId: otherBusinessId, pilotId: otherPilotId });
  for (const operation of operations.filter(value => value.path)) {
    const response = await request(operation.path, { ...operation, cookie: otherOwnerCookie });
    assert.equal(response.status, 404); assert.equal(response.cache, 'no-store');
    assert.equal(calls.at(-1).input.businessId, otherBusinessId);
    assert.equal(calls.at(-1).input.pilotId, pilotId);
    if (operation.method !== 'GET') assert.equal(calls.at(-1).input.staffId, otherStaffId);
  }
});

it('strictly validates list pagination, UUIDs and query keys before service access', async () => {
  for (const path of [
    '?offset=-1', '?offset=01', '?offset=1.5', '?offset=100001', '?offset=Infinity', '?offset=',
    '?offset=0&offset=20', '?offset[x]=20', '?limit=100', '?business_id=other',
    '/not-a-uuid', `/${pilotId}?business_id=${otherBusinessId}`, `/${pilotId}?unknown=1`
  ]) {
    const response = await request(path); assert.equal(response.status, 400, path); assert.equal(response.cache, 'no-store');
  }
  assert.equal(calls.length, 0);
  assert.equal((await request('?offset=100000')).status, 200);
  assert.deepEqual(calls[0].input, { businessId, offset: 100000 });
});

it('strictly validates creation and rejects client-controlled identity, start dates and result state', async () => {
  for (const body of [
    {}, { ...creation, request_id: 'invalid' }, { ...creation, name: '' }, { ...creation, name: '   ' }, { ...creation, name: 'a'.repeat(101) },
    { ...creation, duration_days: '30' }, { ...creation, duration_days: 15 },
    { ...creation, business_id: otherBusinessId }, { ...creation, staff_id: otherStaffId },
    { ...creation, started_at: '2020-01-01' }, { ...creation, status: 'completed' }, { ...creation, baseline: {} }
  ]) {
    const response = await request('', { method: 'POST', body }); assert.equal(response.status, 400, JSON.stringify(body)); assert.equal(response.cache, 'no-store');
  }
  assert.equal((await request('?business_id=other', { method: 'POST', body: creation })).status, 400);
  assert.equal(calls.length, 0);
  for (const duration_days of [14, 30, 60]) assert.equal((await request('', { method: 'POST', body: { ...creation, duration_days } })).status, 201);
});

it('accepts only supported checklist statuses, bounded notes and known check keys without fabricated proof fields', async () => {
  const path = `/${pilotId}/checks/purchase`;
  for (const body of [
    {}, { ...evidence, status: 'verified' }, { ...evidence, status: true }, { ...evidence, note: 42 },
    { ...evidence, note: 'a'.repeat(501) }, { ...evidence, business_id: otherBusinessId },
    { ...evidence, updated_at: '2020-01-01' }, { ...evidence, evidence_type: 'automatic' }, { ...evidence, required: false }
  ]) assert.equal((await request(path, { method: 'PUT', body })).status, 400, JSON.stringify(body));
  for (const invalidPath of [`/${pilotId}/checks/unknown`, '/invalid/checks/purchase', `${path}?status=passed`, `${path}?business_id=other`]) {
    assert.equal((await request(invalidPath, { method: 'PUT', body: evidence })).status, 400, invalidPath);
  }
  assert.equal(calls.length, 0);
  for (const status of ['pending', 'passed', 'failed']) assert.equal((await request(path, { method: 'PUT', body: { status, note: 'Recorded by owner' } })).status, 200);
  assert.equal((await request(`/${pilotId}/checks/wallet_installation`, { method: 'PUT', body: { status: 'not_applicable', note: 'No Wallet in this pilot' } })).status, 200);
  assert.equal((await request(path, { method: 'PUT', body: { status: 'pending', note: '' } })).status, 200);
});

it('requires explicit completion or stop outcome and a nonempty bounded stop reason', async () => {
  const path = `/${pilotId}/close`;
  for (const body of [
    {}, { note: 'Missing outcome' }, { ...closure, outcome: 'closed' }, { ...closure, outcome: 'active' },
    { ...closure, note: '' }, { ...closure, note: '   ' }, { ...closure, note: 'a'.repeat(501) },
    { ...closure, note: true }, { ...closure, business_id: otherBusinessId }, { ...closure, closed_at: '2020-01-01' }, { ...closure, success: true }
  ]) assert.equal((await request(path, { method: 'POST', body })).status, 400, JSON.stringify(body));
  assert.equal((await request(`${path}?outcome=completed`, { method: 'POST', body: closure })).status, 400);
  assert.equal((await request('/invalid/close', { method: 'POST', body: closure })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request(path, { method: 'POST', body: { outcome: 'completed', note: '' } })).status, 200);
  assert.equal((await request(path, { method: 'POST', body: closure })).status, 200);
});

it('exposes no update, reopen or delete endpoint for immutable pilot identity and closed history', async () => {
  for (const operation of [
    { path: `/${pilotId}`, method: 'PUT', body: { name: 'Changed', duration_days: 60 } },
    { path: `/${pilotId}`, method: 'PATCH', body: { started_at: '2020-01-01' } },
    { path: `/${pilotId}`, method: 'DELETE', body: {} },
    { path: `/${pilotId}/reopen`, method: 'POST', body: {} }
  ]) assert.equal((await request(operation.path, operation)).status, 404);
  assert.equal(calls.length, 0);
});

it('accepts a bounded POS/version profile and never accepts client-chosen checklist versions', async()=>{
 const profile={vendor:' Odoo ',pos_version:'18.0',module_version:'18.0.2.0.0',deployment:'self_hosted'};
 assert.equal((await request('',{method:'POST',body:{...creation,pos_profile:profile}})).status,201);
 assert.deepEqual(calls.at(-1).input.posProfile,{...profile,vendor:'Odoo'});
 calls=[];
 for(const pos_profile of [{...profile,api_key:'not-allowed'},{...profile,pos_version:''},{...profile,vendor:'a'.repeat(65)},{...profile,vendor:'Od\u0000oo'},{...profile,deployment:'invented'},'Odoo'])assert.equal((await request('',{method:'POST',body:{...creation,pos_profile}})).status,400);
 assert.equal((await request('',{method:'POST',body:{...creation,checklist_version:1}})).status,400);assert.equal(calls.length,0);
});
