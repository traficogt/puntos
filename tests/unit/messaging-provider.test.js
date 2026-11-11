// Keep these HTTP-fixture suites in the existing tests/unit/*.test.js test command.
import './messaging/config.test.js';
import './messaging/waha-provider.test.js';
import './messaging/evolution-provider.test.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { config } from '../../src/config/index.js';
import { sendMessage } from '../../src/app/services/messaging-service.js';
import { MessageLogRepo } from '../../src/app/repositories/message-log-repository.js';
import { BillingRepo } from '../../src/app/repositories/billing-repository.js';
import { logger } from '../../src/utils/logger.js';

async function serviceFixture(t, { order, status = 201, response = {} }) {
  const state = { requests: [], created: [], updated: [], events: [], errors: [] };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    state.requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const originalConfig = { ...config };
  t.after(() => Object.assign(config, originalConfig));
  Object.assign(config, {
    MESSAGE_PROVIDER_ORDER: order,
    MESSAGE_PROVIDER_TIMEOUT_MS: 1000,
    WAHA_BASE_URL: url, WAHA_API_KEY: 'fixture-waha-key', WAHA_SESSION: 'fixture',
    EVOLUTION_BASE_URL: url, EVOLUTION_API_KEY: 'fixture-evolution-key', EVOLUTION_INSTANCE: 'fixture'
  });
  for (const method of ['create', 'createSecurity']) {
    t.mock.method(MessageLogRepo, method, async input => { state.created.push(input); return input; });
  }
  for (const method of ['updateStatus', 'updateSecurityStatus']) {
    t.mock.method(MessageLogRepo, method, async (_id, input) => { state.updated.push(input); });
  }
  t.mock.method(BillingRepo, 'recordEvent', async event => { state.events.push(event); });
  t.mock.method(logger, 'error', entry => { state.errors.push(entry); });
  return state;
}

const request = { businessId: 'fixture-business', channel: 'verify', to: '+50255555555', body: 'Tu código es: 123456' };

test('messaging service selects Evolution from configuration and records confirmed delivery', async t => {
  const state = await serviceFixture(t, { order: ['evolution'], response: { key: { id: 'fixture-message' }, status: 'PENDING' } });
  const result = await sendMessage(request);
  assert.equal(result.ok, true);
  assert.equal('provider' in result && result.provider, 'evolution');
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].url, '/message/sendText/fixture');
  assert.equal(state.updated[0].status, 'SENT');
  assert.match(state.updated[0].provider_id, /^evolution:[a-f0-9]{64}$/);
  assert.equal(state.created[0].body, 'Tu código es: ******');
  assert.deepEqual(state.events.map(event => event.event_type), ['message.attempt', 'message.sent']);
  assert.deepEqual(state.errors, []);
});

test('messaging service preserves uncertain delivery in security logs and its result without sending a second message', async t => {
  const state = await serviceFixture(t, {
    order: ['waha', 'evolution'], status: 503,
    response: { message: request.body, recipient: request.to, apiKey: 'fixture-upstream-secret' }
  });
  const result = await sendMessage({ ...request, privilegedLog: true });
  assert.equal(result.ok, false);
  assert.equal('error' in result && result.error, 'DELIVERY_UNCERTAIN');
  assert.deepEqual(state.updated, [{ status: 'FAILED', error: 'DELIVERY_UNCERTAIN', provider_id: null }]);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].url, '/api/sendText');
  assert.deepEqual(state.errors, [{ err: 'DELIVERY_UNCERTAIN' }]);
  assert.deepEqual(state.events.map(event => event.event_type), ['message.attempt', 'message.failed']);
  assert.ok(!JSON.stringify(result).includes(request.to));
  assert.ok(!JSON.stringify(state.updated).includes('fixture-upstream-secret'));
});

test('provider acceptance survives logging and billing failures without a resend signal', async t => {
  const state=await serviceFixture(t,{order:['evolution'],response:{key:{id:'accepted-once'},status:'PENDING'}});
  t.mock.method(MessageLogRepo,'updateStatus',async()=>{throw new Error('fixture log unavailable');});
  t.mock.method(BillingRepo,'recordEvent',async()=>{throw new Error('fixture billing unavailable');});
  const result=await sendMessage(request);
  assert.equal(result.ok,true);
  assert.equal(result.accepted,true);
  assert.equal(state.requests.length,1);
});
