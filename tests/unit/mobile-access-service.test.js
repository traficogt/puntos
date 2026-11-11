import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { getDbContext, runWithDbContext } from '../../src/app/database.js';

import { createMobileAccessService } from '../../src/app/services/mobile-access-service.js';
import { HttpError } from '../../src/utils/http-error.js';
const phone = '50255551234';
const hash = await bcrypt.hash('123456', 4);
const card = { id: 'business-a', name: 'Café', slug: 'cafe' };
const customer = { id: 'customer-a', phone, business_id: card.id, name: 'Ana', points: 2, pending_points: 0, lifetime_points: 2, email: 'private@example.invalid' };
function fixture() {
  const state = { messages: [], codes: [], lookups: 0, failed: 0, consumed: false, sessions: [], grants: [], transaction: false, contexts: [] };
  let queue = Promise.resolve();
  const query = async () => ({ rows: [] });
  const deps = {
    runWithDbContext,
    withTransaction: async fn => {
      const previous = queue; let release = () => {}; queue = new Promise(resolve => { release = resolve; }); await previous;
      state.contexts.push(getDbContext()); state.transaction = true;
      try { return await fn({ query }); } finally { state.transaction = false; release(); }
    },
    repo: {
      lockPhone: async () => {}, requestCounts: async () => ({ minute: 0, hour: 0 }),
      createCode: async value => { state.codes.push(value); }, invalidateCode: async () => { state.consumed = true; },
      latestCode: async () => state.consumed || state.failed >= 5 ? null : ({ id: 'code-a', code_hash: hash }),
      failCode: async () => { state.failed++; }, consumeCode: async () => { state.consumed = true; return true; },
      listCards: async () => { state.lookups++; assert.equal(state.consumed, true); return [card]; },
      getMembership: async (value, businessId) => { assert.equal(value, phone); return businessId === card.id ? { customer, business: card } : null; },
      createGrant: async value => { state.grants.push(value); },
      lockGrant: async () => ({ id: 'grant-a', phone }), consumeGrant: async () => true
    },
    createBrowserSession: async (input, executor) => { assert.equal(state.transaction, true); assert.equal(typeof executor, 'function'); state.sessions.push(input); return { token: 'session-token', session: { absolute_expires_at: '2026-12-01T00:00:00.000Z' } }; },
    sendMessage: async value => { assert.equal(state.transaction, false); state.messages.push(value); return { ok: true }; }
  };
  return { state, deps };
}

test('phone-first access service is available', () => assert.equal(typeof createMobileAccessService, 'function'));
test('request delivers generic phone-only proof without consulting memberships or caller tenant', async () => {
  const { state, deps } = fixture(); const service = createMobileAccessService(deps);
  const result = await runWithDbContext({ tenantId: 'untrusted', platformAdmin: false }, () => service.requestCode({ ...{ phone: '5555-1234', email: 'unverified@example.invalid', businessId: 'untrusted' } }));
  assert.deepEqual(result, { ok: true }); assert.equal(state.lookups, 0);
  assert.equal(state.messages[0].businessId, null); assert.equal(state.messages[0].privilegedLog, true);
  assert.deepEqual(state.messages[0].destinations, { phone }); assert.equal(state.messages[0].email, undefined);
  assert.match(state.messages[0].body, /PuntosFieles/); assert.ok(!state.messages[0].body.includes('Café'));
  assert.equal(state.codes[0].phone, phone); assert.match(state.codes[0].code_hash, /^\$2/);
  assert.ok(state.contexts.every(ctx => ctx.tenantId === null && ctx.platformAdmin === true && ctx.webhookIngest === false));
});
test('failed providers invalidate stored proof and expose only a generic 503', async () => {
  for (const send of [async () => ({ ok: false }), async () => { throw Error('private provider details'); }]) {
    const { state, deps } = fixture(); deps.sendMessage = send;
    await assert.rejects(createMobileAccessService(deps).requestCode({ phone }), error => error instanceof HttpError && error.statusCode === 503 && !error.message.includes('private provider'));
    assert.equal(state.consumed, true); assert.equal(state.codes.length, 1);
  }
});
test('persistent request limits deny at sixty seconds and five requests per hour', async () => {
  for (const counts of [{ minute: 1, hour: 1 }, { minute: 0, hour: 5 }]) {
    const { state, deps } = fixture(); deps.repo.requestCounts = async () => counts;
    await assert.rejects(createMobileAccessService(deps).requestCode({ phone }), { statusCode: 429 });
    assert.equal(state.codes.length, 0); assert.equal(state.messages.length, 0);
  }
});
test('five bad codes commit their attempts without consulting memberships', async () => {
  const { state, deps } = fixture(); const service = createMobileAccessService(deps);
  for (let n = 0; n < 5; n++) await assert.rejects(service.verify({ phone, code: '000000' }), { statusCode: 401 });
  assert.equal(state.failed, 5); assert.equal(state.transaction, false);
  await assert.rejects(service.verify({ phone, code: '123456' }), { statusCode: 401 });
  assert.equal(state.lookups, 0); assert.equal(state.sessions.length, 0);
});
test('one verified membership returns existing customer session shape and resists replay', async () => {
  const { state, deps } = fixture(); const service = createMobileAccessService(deps);
  const results = await Promise.allSettled([service.verify({ phone, code: '123456' }), service.verify({ phone, code: '123456' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const result = results.find(r => r.status === 'fulfilled').value;
  assert.equal(result.status, 'signed_in'); assert.equal(result.token, 'session-token'); assert.deepEqual(result.business, card);
  assert.equal(result.customer.email, undefined); assert.equal(result.customer.business_id, undefined);
  assert.equal(state.sessions.length, 1); assert.equal(state.sessions[0].businessId, card.id);
});
test('verified zero-card and multi-card phones return explicit outcomes and only hashed grants are stored', async () => {
  for (const cards of [[], [card, { id: 'business-b', name: 'B', slug: 'b' }]]) {
    const { state, deps } = fixture(); deps.repo.listCards = async () => cards;
    const result = await createMobileAccessService(deps).verify({ phone, code: '123456' });
    assert.equal(result.status, cards.length ? 'choose_card' : 'no_cards'); assert.equal(state.sessions.length, 0);
    if (cards.length) { assert.deepEqual(result.cards, cards); assert.ok(Buffer.from(result.accessToken, 'base64url').length >= 32); assert.notEqual(state.grants[0].token_hash, result.accessToken); assert.match(state.grants[0].token_hash, /^[a-f0-9]{64}$/); assert.equal(state.grants[0].phone, phone); }
  }
});
test('selection revalidates grant-bound phone membership and uses the same transaction for the session', async () => {
  const { state, deps } = fixture(); const service = createMobileAccessService(deps);
  await assert.rejects(service.select({ ...{ accessToken: 'A'.repeat(43), businessId: 'other-business', phone: '50299999999' } }), { statusCode: 401 });
  assert.equal(state.sessions.length, 0);
  assert.equal((await service.select({ accessToken: 'A'.repeat(43), businessId: card.id })).status, 'signed_in');
});
