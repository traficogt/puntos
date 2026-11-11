import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMobileRoutes } from '../../src/app/routes/mobile-routes.js';
import { errorHandler } from '../../src/middleware/common.js';
import { rateLimitByPhone, strictRateLimit } from '../../src/middleware/rate-limit.js';
import { createBrowserSession, getBrowserSession, touchBrowserSessionIfNeeded } from '../../src/app/services/auth-session-service.js';
import { getDbTenantId, runWithDbContext, setDbTenantId } from '../../src/app/db/context.js';
import { unauthorized } from '../../src/utils/http-error.js';

const noop = (_req, _res, next) => next();
const customerId = '11111111-1111-4111-8111-111111111111';
const businessId = '22222222-2222-4222-8222-222222222222';
const otherBusinessId = '33333333-3333-4333-8333-333333333333';
const wallet = { providers: { apple: true, google: true }, passes: [] };

async function fixture(t, overrides = {}) {
  const state = {
    customer: { id: customerId, business_id: businessId, name: 'Ana', phone: '50255551234', points: 40, pending_points: 3, lifetime_points: 100, email: 'private@example.test' },
    business: { id: businessId, slug: 'cafe', name: 'Café', category: 'cafe', plan: 'NEGOCIO', program_type: 'SPEND', program_json: { external_awards: { enabled: true, api_key: 'secret' }, pos_integration: { secret: true } }, customer_branding_json: { primary_color: '#123456', internal: 'private' } },
    requests: [], verifies: [], touched: [], qr: [], walletAuth: [], maintenance: [], deleted: [], rewardReads: 0, progressReads: 0,
    transactions: [{ id: 'txn-1', business_id: businessId, customer_id: customerId, points_delta: 40, meta: { internal: true } }],
    redemptions: [{ id: 'redemption-1', business_id: businessId, customer_id: customerId, points_cost: 20 }],
    rewards: [{ id: 'reward-1', business_id: businessId, active: true }, { id: 'hidden', business_id: businessId, active: false }],
    progress: { available_points: 42, pending_points: 0, as_of: '2026-11-11T12:00:00.000Z', reward: null, choices: [{ id: 'reward-1', active: true, available: true }], earning: null, conditions: null, next_refresh_at: null },
    overrides: {},
    sessionOverride: null
  };
  const client = { query: async () => { throw Error('Unexpected database query'); } };
  const assertTenant = () => assert.equal(getDbTenantId(), businessId);
  const session = await createBrowserSession({ actorType: 'CUSTOMER', actorId: customerId, businessId });
  const deps = {
    getDbClient: () => { assertTenant(); return client; },
    getCustomerRewardProgress: async (db, ids) => { assertTenant(); assert.equal(db, client); assert.deepEqual(ids, { businessId, customerId }); state.progressReads++; return state.progress; },
    BusinessRepo: {
      getPublicBySlug: async slug => slug === state.business.slug ? state.business : null,
      getById: async id => { assertTenant(); assert.equal(id, businessId); return state.business; }
    },
    CustomerRepo: {
      getById: async id => { assertTenant(); assert.equal(id, customerId); return state.customer; },
      softDelete: async id => { assertTenant(); state.deleted.push(id); state.customer = null; }
    },
    TxnRepo: { listByCustomer: async (id, limit) => { assertTenant(); assert.equal(id, customerId); assert.equal(limit, 50); return state.transactions; } },
    RedemptionRepo: { listByCustomer: async (id, limit) => { assertTenant(); assert.equal(id, customerId); assert.equal(limit, 50); return state.redemptions; } },
    RewardRepo: { listByBusiness: async id => { assertTenant(); assert.equal(id, businessId); state.rewardReads++; return state.rewards; } },
    PlanConfigService: { getPlanFeatureOverrides: async () => state.overrides },
    setTenantForRequest: async (req, id) => { setDbTenantId(id); req.tenantId = id; req.tenant = { id }; },
    getBrowserSession: async token => state.sessionOverride || getBrowserSession(token),
    touchBrowserSessionIfNeeded: async value => { state.touched.push(value.id); return touchBrowserSessionIfNeeded(value); },
    requestJoinCode: async input => { assertTenant(); state.requests.push(input); return { ok: true }; },
    verifyJoinCode: async input => {
      assertTenant(); state.verifies.push(input);
      if (input.code !== '123456') throw unauthorized('Código inválido');
      return { token: session.token, customer: state.customer };
    },
    issueCustomerQr: async auth => { assertTenant(); state.qr.push(auth); return { token: 'signed-qr', jti: 'qr-id', exp: 2000000000 }; },
    settlePendingPointsForCustomer: async (id, bid) => { assertTenant(); state.maintenance.push(['settle', id, bid]); state.customer.points += state.customer.pending_points; state.customer.pending_points = 0; },
    expirePointsForCustomer: async (id, bid) => { assertTenant(); state.maintenance.push(['expire', id, bid]); state.customer.points -= 1; },
    walletService: {
      status: async auth => { assertTenant(); state.walletAuth.push(auth); return wallet; },
      issue: async (auth, provider) => { assertTenant(); state.walletAuth.push(auth); return { url: provider === 'apple' ? '/api/customer/wallet/apple/download' : 'https://pay.google.com/gp/v/save/test-token' }; },
      downloadApple: async auth => { assertTenant(); state.walletAuth.push(auth); return Buffer.from('signed-pkpass'); }
    },
    withTransaction: async fn => fn(),
    requestCodeLimit: noop,
    verifyCodeLimit: noop,
    requestPhoneLimit: noop,
    verifyPhoneLimit: noop,
    walletIssueLimit: noop,
    ...overrides
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => runWithDbContext({ tenantId: otherBusinessId, platformAdmin: false }, () => { req.tenantId = otherBusinessId; next(); }));
  app.use('/api/v1', createMobileRoutes(/** @type {any} */ (deps)));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/api/v1/mobile`;
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const auth = { Authorization: `Bearer ${session.token}` };
  return { state, session, request, auth };
}

function assertPrivate(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('set-cookie'), null);
}

test('mobile business discovery exposes only the sanitized public contract', async t => {
  const f = await fixture(t);
  const res = await f.request('/business/cafe');
  assert.equal(res.status, 200); assertPrivate(res);
  const data = await res.json();
  assert.equal(data.id, businessId);
  assert.deepEqual(data.program_json, { external_awards: { enabled: true } });
  assert.equal(data.customer_branding.primary_color, '#123456');
  assert.equal(data.customer_branding.internal, undefined);
  assert.equal(data.plan, undefined);
  assert.equal((await f.request('/business/missing')).status, 404);
});

test('mobile OTP validates inputs and mode before calling existing OTP services', async t => {
  const f = await fixture(t);
  for (const [path, body] of [
    ['/business/cafe/login/request-code', { phone: '12' }],
    ['/business/cafe/login/request-code', { phone: 'letters' }],
    ['/business/cafe/login/verify', { phone: '55551234', code: '1' }],
    ['/business/cafe/login/verify', { phone: '55551234' }],
    ['/business/cafe/join/request-code', { phone: '55551234', email: 'invalid' }]
  ]) {
    const res = await f.request(path, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(res.status, 400); assertPrivate(res);
  }
  assert.equal((await f.request('/business/cafe/unknown/request-code', { method: 'POST', body: JSON.stringify({ phone: '55551234' }) })).status, 404);
  assert.equal(f.state.requests.length, 0); assert.equal(f.state.verifies.length, 0);
});

test('login and join preserve phone normalization and existing-customer semantics', async t => {
  const f = await fixture(t);
  for (const mode of ['login', 'join']) {
    const res = await f.request(`/business/cafe/${mode}/request-code`, { method: 'POST', body: JSON.stringify({ phone: '5555-1234', name: 'Ana' }) });
    assert.equal(res.status, 200); assertPrivate(res);
    const call = f.state.requests.at(-1);
    assert.equal(call.phone, '50255551234');
    assert.equal(Boolean(call.requireExisting), mode === 'login');
  }
});

test('verify returns the actual opaque server session and absolute expiry without cookies', async t => {
  const f = await fixture(t);
  for (const mode of ['login', 'join']) {
    const res = await f.request(`/business/cafe/${mode}/verify`, { method: 'POST', body: JSON.stringify({ phone: '(502) 5555-1234', code: '123456', referralCode: 'ABC123' }) });
    assert.equal(res.status, 200); assertPrivate(res);
    const data = await res.json();
    assert.equal(data.token, f.session.token);
    assert.equal(data.expiresAt, f.session.session.absolute_expires_at);
    assert.deepEqual(data.business, { id: businessId, name: 'Café', slug: 'cafe' });
    assert.deepEqual(data.customer, { id: customerId, name: 'Ana', phone: '50255551234', points: 40, pending_points: 3, lifetime_points: 100 });
    const call = f.state.verifies.at(-1);
    assert.equal(Boolean(call.requireExisting), mode === 'login');
    assert.equal(call.referralCode, mode === 'login' ? null : 'ABC123');
  }
  assert.equal((await f.request('/business/cafe/login/verify', { method: 'POST', body: JSON.stringify({ phone: '55551234', code: '000000' }) })).status, 401);
});

test('mobile OTP preserves phone rate limiting across equivalent normalized numbers', async t => {
  const f = await fixture(t, { requestPhoneLimit: rateLimitByPhone(3, 600000) });
  for (let n = 0; n < 3; n++) {
    assert.equal((await f.request('/business/cafe/login/request-code', { method: 'POST', body: JSON.stringify({ phone: '55119876' }) })).status, 200);
  }
  const blocked = await f.request('/business/cafe/login/request-code', { method: 'POST', body: JSON.stringify({ phone: '+502 5511-9876' }) });
  assert.equal(blocked.status, 429); assertPrivate(blocked);
  assert.equal(f.state.requests.length, 3);
});

test('customer access rejects missing, cookie-only, wrong-actor, revoked and expired sessions', async t => {
  const f = await fixture(t);
  const staff = await createBrowserSession({ actorType: 'STAFF', actorId: customerId, businessId });
  const attempts = [
    {}, { cookie: `pf_customer=${f.session.token}` }, { Authorization: 'Basic abc' },
    { Authorization: 'Bearer unknown-token' }, { Authorization: `Bearer ${staff.token}` }
  ];
  for (const headers of attempts) {
    const res = await f.request('/customer', { headers });
    assert.equal(res.status, 401); assertPrivate(res);
  }
  for (const patch of [
    { invalidated_at: new Date().toISOString() },
    { idle_expires_at: new Date(Date.now() - 1000).toISOString() },
    { absolute_expires_at: new Date(Date.now() - 1000).toISOString() },
    { id: null }, { actor_id: null }, { business_id: null }
  ]) {
    f.state.sessionOverride = { ...f.session.session, ...patch };
    assert.equal((await f.request('/customer', { headers: f.auth })).status, 401);
  }
  assert.equal(f.state.touched.length, 0);
  assert.equal(f.state.maintenance.length, 0);
});

test('customer summary derives tenant and identity from bearer session and settles balances', async t => {
  const f = await fixture(t);
  const res = await f.request(`/customer?business_id=${otherBusinessId}&customer_id=other`, { headers: f.auth });
  assert.equal(res.status, 200); assertPrivate(res);
  const data = await res.json();
  assert.equal(data.business.id, businessId);
  assert.equal(data.business.customer_branding.internal, undefined);
  assert.equal(data.business.features.rewards, true);
  assert.deepEqual(data.customer, { id: customerId, name: 'Ana', phone: '50255551234', points: 42, pending_points: 0, lifetime_points: 100 });
  assert.deepEqual(data.rewards, [{ id: 'reward-1', active: true }]);
  assert.deepEqual(data.transactions, [{ id: 'txn-1', points_delta: 40 }]);
  assert.deepEqual(data.redemptions, [{ id: 'redemption-1', points_cost: 20 }]);
  assert.deepEqual(data.wallet, wallet);
  assert.deepEqual(f.state.maintenance, [['settle', customerId, businessId], ['expire', customerId, businessId]]);
  assert.deepEqual(f.state.touched, [f.session.session.id]);
});

test('summary hides rewards without querying them when the plan feature is disabled', async t => {
  const f = await fixture(t);
  f.state.overrides = { NEGOCIO: { rewards: false } };
  const res = await f.request('/customer', { headers: f.auth });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.rewards, []);
  assert.equal(data.reward_progress, null);
  assert.equal(f.state.rewardReads, 0);
  assert.equal(f.state.progressReads, 0);
});

test('missing, deleted and cross-tenant customers cannot read data or issue QR', async t => {
  for (const patch of [null, { deleted_at: new Date().toISOString() }, { business_id: otherBusinessId }]) {
    const f = await fixture(t);
    f.state.customer = patch ? { ...f.state.customer, ...patch } : null;
    const res = await f.request('/customer/qr', { method: 'POST', headers: f.auth });
    assert.equal(res.status, 404); assertPrivate(res);
    assert.equal((await res.json()).code, 'CUSTOMER_NOT_FOUND');
    assert.equal(f.state.qr.length, 0);
    assert.ok((await getBrowserSession(f.session.token)).invalidated_at);
  }
});

test('QR requests use the authenticated identity and return the existing short-lived token shape', async t => {
  const f = await fixture(t);
  const res = await f.request('/customer/qr', { method: 'POST', headers: f.auth, body: JSON.stringify({ customerId: 'other', businessId: otherBusinessId }) });
  assert.equal(res.status, 200); assertPrivate(res);
  assert.deepEqual(await res.json(), { token: 'signed-qr', jti: 'qr-id', exp: 2000000000 });
  assert.deepEqual(f.state.qr, [{ customerId, businessId }]);
});

test('logout revokes the current session and subsequent bearer requests fail', async t => {
  const f = await fixture(t);
  const res = await f.request('/customer/logout', { method: 'POST', headers: f.auth });
  assert.equal(res.status, 200); assertPrivate(res);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal((await getBrowserSession(f.session.token)).invalidation_reason, 'logout');
  assert.equal((await f.request('/customer', { headers: f.auth })).status, 401);
});

test('deletion requires explicit confirmation and invalidates every customer session', async t => {
  const f = await fixture(t);
  const second = await createBrowserSession({ actorType: 'CUSTOMER', actorId: customerId, businessId });
  const other = await createBrowserSession({ actorType: 'CUSTOMER', actorId: 'other-customer', businessId });
  for (const body of [{}, { confirm: false }, { confirm: 'true' }]) {
    assert.equal((await f.request('/customer', { method: 'DELETE', headers: f.auth, body: JSON.stringify(body) })).status, 400);
  }
  assert.deepEqual(f.state.deleted, []);
  const res = await f.request('/customer', { method: 'DELETE', headers: f.auth, body: JSON.stringify({ confirm: true }) });
  assert.equal(res.status, 200); assertPrivate(res);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(f.state.deleted, [customerId]);
  assert.equal((await getBrowserSession(second.token)).invalidation_reason, 'customer_deleted');
  assert.equal((await getBrowserSession(other.token)).invalidated_at, null);
  assert.equal((await f.request('/customer', { headers: f.auth })).status, 401);
});

test('wallet issuance and Apple downloads use bearer identity and the mobile download route', async t => {
  const f = await fixture(t);
  for (const provider of ['google', 'apple']) {
    const res = await f.request(`/customer/wallet/${provider}`, { method: 'POST', headers: f.auth });
    assert.equal(res.status, 200); assertPrivate(res);
    assert.equal((await res.json()).url, provider === 'apple' ? '/api/v1/mobile/customer/wallet/apple/download' : 'https://pay.google.com/gp/v/save/test-token');
  }
  const file = await f.request('/customer/wallet/apple/download', { headers: f.auth });
  assert.equal(file.status, 200); assertPrivate(file);
  assert.match(file.headers.get('content-type'), /application\/vnd.apple.pkpass/);
  assert.equal(await file.text(), 'signed-pkpass');
  assert.equal((await f.request('/customer/wallet/apple/download')).status, 401);
  assert.equal((await f.request('/customer/wallet/other', { method: 'POST', headers: f.auth })).status, 404);
  assert.ok(f.state.walletAuth.every(auth => auth.id === customerId && auth.business_id === businessId));
});


test('summary excludes foreign records and internal transaction metadata', async t => {
  const f = await fixture(t);
  f.state.transactions.push({ ...f.state.transactions[0], id: 'foreign-transaction', business_id: otherBusinessId });
  f.state.transactions.push({ ...f.state.transactions[0], id: 'other-customer-transaction', customer_id: 'someone-else' });
  f.state.redemptions.push({ ...f.state.redemptions[0], id: 'foreign-redemption', business_id: otherBusinessId });
  f.state.rewards.push({ ...f.state.rewards[0], id: 'foreign-reward', business_id: otherBusinessId });
  const res = await f.request('/customer', { headers: f.auth });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.transactions, [{ id: 'txn-1', points_delta: 40 }]);
  assert.deepEqual(data.redemptions, [{ id: 'redemption-1', points_cost: 20 }]);
  assert.deepEqual(data.rewards, [{ id: 'reward-1', active: true }]);
});


test('mobile authentication retains active sessions when a best-effort touch fails', async t => {
  const f = await fixture(t, { touchBrowserSessionIfNeeded: async () => { throw Error('touch unavailable'); } });
  const res = await f.request('/customer/qr', { method: 'POST', headers: f.auth });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).token, 'signed-qr');
});

test('OTP request routes apply the existing strict IP limiter', async t => {
  const f = await fixture(t, { requestCodeLimit: strictRateLimit });
  for (let n = 0; n < 5; n++) {
    assert.equal((await f.request('/business/cafe/login/request-code', { method: 'POST', body: JSON.stringify({ phone: '55118765' }) })).status, 200);
  }
  const res = await f.request('/business/cafe/login/request-code', { method: 'POST', body: JSON.stringify({ phone: '55118765' }) });
  assert.equal(res.status, 429); assertPrivate(res);
  assert.equal(f.state.requests.length, 5);
});

test('OTP verification routes apply the existing phone attempt limiter', async t => {
  const f = await fixture(t, { verifyPhoneLimit: rateLimitByPhone(10, 600000) });
  for (let n = 0; n < 10; n++) {
    assert.equal((await f.request('/business/cafe/login/verify', { method: 'POST', body: JSON.stringify({ phone: '55117654', code: '000000' }) })).status, 401);
  }
  const res = await f.request('/business/cafe/login/verify', { method: 'POST', body: JSON.stringify({ phone: '55117654', code: '000000' }) });
  assert.equal(res.status, 429); assertPrivate(res);
  assert.equal(f.state.verifies.length, 10);
});

test('mobile push registration, status and test use bearer identity while revoke needs only installation credential', async t => {
  const calls = [];
  const f = await fixture(t, {
    pushService: {
      status: () => ({ available: true }),
      register: async (auth, session, body) => { calls.push(['register',auth,session.id,body]); return { enabled:true,expiresAt:'2026-12-10T00:00:00.000Z' }; },
      test: async (auth, body) => { calls.push(['test',auth,body]); return { sent:true }; },
      revoke: async body => { calls.push(['revoke',body]); return { ok:true }; }
    }, pushRegisterLimit:noop,pushTestLimit:noop,pushRevokeLimit:noop
  });
  const body={installationId:'33333333-3333-4333-8333-333333333333',installationSecret:'A'.repeat(43),token:'ab'.repeat(32),platform:'ios'};
  const credential={installationId:body.installationId,installationSecret:body.installationSecret};
  for (const [path,method] of [['/customer/push-device','PUT'],['/customer/push-device/test','POST'],['/customer/push-status','GET']]) {
    const rejected=await f.request(path,{method});assert.equal(rejected.status,401);assertPrivate(rejected);
  }
  const status=await f.request('/customer/push-status',{headers:f.auth});
  assert.deepEqual(await status.json(),{available:true});assertPrivate(status);
  const registered=await f.request('/customer/push-device',{method:'PUT',headers:f.auth,body:JSON.stringify(body)});
  assert.equal(registered.status,200);assertPrivate(registered);assert.equal((await registered.json()).enabled,true);
  const sent=await f.request('/customer/push-device/test',{method:'POST',headers:f.auth,body:JSON.stringify(credential)});
  assert.deepEqual(await sent.json(),{sent:true});
  await f.request('/customer/logout',{method:'POST',headers:f.auth});
  const revoked=await f.request('/customer/push-device/revoke',{method:'POST',headers:{Authorization:'Bearer expired-token'},body:JSON.stringify(credential)});
  assert.equal(revoked.status,200);assertPrivate(revoked);assert.deepEqual(await revoked.json(),{ok:true});
  assert.deepEqual(calls,[['register',{id:customerId,business_id:businessId},f.session.session.id,body],['test',{id:customerId,business_id:businessId},credential],['revoke',credential]]);
});

test('credential-only push revoke and explicit test are rate limited', async t => {
  let revoke=0,send=0;
  const f=await fixture(t,{pushService:{revoke:async()=>{revoke++;return {ok:true};},test:async()=>{send++;return {sent:true};}}});
  for(let i=0;i<10;i++) assert.equal((await f.request('/customer/push-device/revoke',{method:'POST',body:'{}'})).status,200);
  assert.equal((await f.request('/customer/push-device/revoke',{method:'POST',body:'{}'})).status,429);
  for(let i=0;i<3;i++) assert.equal((await f.request('/customer/push-device/test',{method:'POST',headers:f.auth,body:'{}'})).status,200);
  assert.equal((await f.request('/customer/push-device/test',{method:'POST',headers:f.auth,body:'{}'})).status,429);
  assert.equal(revoke,10);assert.equal(send,3);
});


test('mobile legacy choices preserve protected terms and hide ineligible choices without requiring enough points', async t => {
  const f = await fixture(t);
  const protectedChoice = {
    id: 'reward-1', name: 'Café original', description: 'Tamaño original', points_cost: 50,
    active: true, available: true, protected: true, stock: 4, valid_until: '2026-12-01T00:00:00.000Z',
    branch_ids: ['center'], branch_labels: ['Centro']
  };
  f.state.rewards[0] = { ...protectedChoice, business_id: businessId, name: 'Changed catalog', points_cost: 5 };
  f.state.progress = { ...f.state.progress, choices: [
    protectedChoice,
    { ...protectedChoice, id: 'manual-unavailable', available: false },
    { ...protectedChoice, id: 'stale-inventory', available: false, inventory: { state: 'stale', required: true, branches: [] } },
    { ...protectedChoice, id: 'daily-guard', available: false },
    { ...protectedChoice, id: 'inactive', active: false, available: true }
  ] };
  const res = await f.request(`/customer?business_id=${otherBusinessId}&customer_id=other`, { headers: f.auth });
  assert.equal(res.status, 200); assertPrivate(res);
  const data = await res.json();
  const { available, protected: isProtected, ...legacyChoice } = protectedChoice;
  assert.equal(available, true); assert.equal(isProtected, true);
  assert.deepEqual(data.rewards, [legacyChoice]);
  assert.ok(data.rewards[0].points_cost > data.customer.points, 'insufficient balance does not hide a choice');
  assert.deepEqual(data.reward_progress, f.state.progress);
  assert.equal(f.state.rewardReads, 0, 'never read unprotected catalog');
  assert.equal(f.state.progressReads, 1);
});

test('mobile progress failure does not fall back to unprotected catalog rewards', async t => {
  const f = await fixture(t, { getCustomerRewardProgress: async () => { throw Error('Progress unavailable'); } });
  const res = await f.request('/customer', { headers: f.auth });
  assert.equal(res.status, 500); assertPrivate(res);
  const data = await res.json();
  assert.equal(data.rewards, undefined);
  assert.equal(f.state.rewardReads, 0);
});

test('mobile missing progress supplies no legacy rewards', async t => {
  const f = await fixture(t);
  f.state.progress = null;
  const res = await f.request('/customer', { headers: f.auth });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.rewards, []); assert.equal(data.reward_progress, null);
  assert.equal(f.state.rewardReads, 0);
});

test('legacy reward expiry keeps the installed-client UTC millisecond timestamp format', async t => {
  const f = await fixture(t);
  f.state.progress.choices = [{ id: 'reward-1', active: true, available: true, valid_until: '2026-12-01T03:04:05.123456-06:00' }];
  const res = await f.request('/customer', { headers: f.auth });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.rewards[0].valid_until, '2026-12-01T09:04:05.123Z');
  assert.equal(Date.parse(data.rewards[0].valid_until), Date.parse(data.reward_progress.choices[0].valid_until));
});
