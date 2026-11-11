import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createWahaProvider } from '../../../src/app/services/messaging/providers/waha-provider.js';
import { createMessageRouter } from '../../../src/app/services/messaging/message-router.js';

const message = { channel: 'verify', body: 'fixture message', destinations: { phone: '+50255555555' } };
const baseConfig = { WAHA_API_KEY: 'fixture-api-key', WAHA_SESSION: 'fixture', MESSAGE_PROVIDER_TIMEOUT_MS: 1000 };

async function fixture(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
}

function routerFor(provider, fallbackCalls) {
  return createMessageRouter({ order: ['waha', 'fallback'], providers: {
    waha: provider,
    fallback: { name: 'fallback', canSend: () => true, send: async () => { fallbackCalls.push(true); return { ok: true }; } }
  } });
}

test('WAHA uses X-Api-Key, preserves a base path and converts E.164 to a direct chat ID', async t => {
  /** @type {{ path: string, headers: import('node:http').IncomingHttpHeaders, method: string, body: Record<string, unknown> } | null} */
  let request = null;
  const baseUrl = await fixture(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    request = { path: req.url, headers: req.headers, method: req.method, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'true_50255555555@c.us_fixture-id' }));
  });
  const provider = createWahaProvider({ config: { ...baseConfig, WAHA_BASE_URL: `${baseUrl}/gateway/` } });
  const out = await provider.send(message);
  assert.ok(request);
  assert.equal(request.headers['x-api-key'], baseConfig.WAHA_API_KEY);
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/gateway/api/sendText');
  assert.deepEqual(request.body, { session: 'fixture', chatId: '50255555555@c.us', text: message.body });
  assert.equal(out.ok, true);
  assert.match(out.providerId, /^waha:[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(out).includes('50255555555'));
});

test('WAHA requires credentials and accepts only normalized international individual numbers', () => {
  const provider = createWahaProvider({ config: { ...baseConfig, WAHA_BASE_URL: 'https://example.invalid' } });
  assert.equal(provider.canSend(message), true);
  assert.equal(provider.canSend({ destinations: { phone: '50255555555' } }), true);
  for (const phone of ['', '+0123456789', '123', '+50255555555@g.us', 'call +50255555555', '+1234567890123456']) {
    assert.equal(provider.canSend({ destinations: { phone } }), false);
  }
  assert.equal(createWahaProvider({ config: { WAHA_BASE_URL: 'https://example.invalid' } }).canSend(message), false);
  assert.equal(createWahaProvider({ config: { ...baseConfig, WAHA_BASE_URL: 'https://user:secret@example.invalid' } }).canSend(message), false);
});

test('WAHA fails before dispatch for invalid recipient or missing configuration', async () => {
  let sent = 0;
  const provider = createWahaProvider({ config: { ...baseConfig, WAHA_BASE_URL: 'https://example.invalid' }, fetchImpl: async () => { sent++; return new Response('{}'); } });
  await assert.rejects(provider.send({ ...message, destinations: { phone: 'bad' } }), { message: 'MESSAGE_PROVIDER_NOT_READY' });
  assert.equal(sent, 0);
});

test('a definitive HTTP rejection is generic and permits the existing fallback behavior', async t => {
  const baseUrl = await fixture(t, (_req, res) => { res.writeHead(401); res.end(JSON.stringify({ secret: baseConfig.WAHA_API_KEY, phone: message.destinations.phone, text: message.body })); });
  const provider = createWahaProvider({ config: { ...baseConfig, WAHA_BASE_URL: baseUrl } });
  await assert.rejects(provider.send(message), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'MESSAGE_PROVIDER_REJECTED');
    assert.equal('deliveryUncertain' in error && error.deliveryUncertain, false);
    assert.ok(!JSON.stringify(error).includes(baseConfig.WAHA_API_KEY));
    return true;
  });
  const fallbackCalls = [];
  const out = await routerFor(provider, fallbackCalls).send(message);
  assert.equal(out.ok, true);
  assert.deepEqual(fallbackCalls, [true]);
});

for (const scenario of ['timeout', 'body-timeout', 'server-error', 'invalid-json', 'missing-id', 'oversized-response', 'socket-close']) {
  test(`WAHA ${scenario} is bounded and stops automatic fallback after uncertain delivery`, async t => {
    let attempts = 0;
    const baseUrl = await fixture(t, (_req, res) => {
      attempts++;
      if (scenario === 'timeout') { const timer = setTimeout(() => res.end('{"id":"late"}'), 500); t.after(() => clearTimeout(timer)); return; }
      if (scenario === 'socket-close') { res.destroy(); return; }
      res.writeHead(scenario === 'server-error' ? 503 : 200, { 'Content-Type': 'application/json' });
      if (scenario === 'body-timeout') { res.write('{'); const timer = setTimeout(() => res.end('"id":"late"}'), 500); t.after(() => clearTimeout(timer)); return; }
      if (scenario === 'invalid-json') { res.end('private failure'); return; }
      if (scenario === 'oversized-response') { res.end(JSON.stringify({ id: 'x', extra: 'x'.repeat(70000) })); return; }
      res.end(JSON.stringify({ secret: baseConfig.WAHA_API_KEY, phone: message.destinations.phone }));
    });
    const provider = createWahaProvider({ config: { ...baseConfig, WAHA_BASE_URL: baseUrl, MESSAGE_PROVIDER_TIMEOUT_MS: scenario.endsWith('timeout') ? 150 : 1000 } });
    const fallbackCalls = [];
    const started = Date.now();
    const out = await routerFor(provider, fallbackCalls).send(message);
    assert.equal(out.ok, false);
    assert.equal(out.error, 'DELIVERY_UNCERTAIN');
    assert.deepEqual(out.attempts, ['waha']);
    assert.equal(attempts, 1);
    assert.deepEqual(fallbackCalls, []);
    assert.ok(Date.now() - started < 2000);
    assert.ok(!JSON.stringify(out).includes(baseConfig.WAHA_API_KEY));
    assert.ok(!JSON.stringify(out).includes(message.destinations.phone));
  });
}

test('WAHA never forwards a credential or message through an HTTP redirect', async t => {
  let redirectedRequests = 0;
  const target = await fixture(t, (_req, res) => { redirectedRequests++; res.end('{"id":"should-not-send"}'); });
  const baseUrl = await fixture(t, (_req, res) => { res.writeHead(307, { location: target }); res.end(); });
  const provider = createWahaProvider({ config: { ...baseConfig, WAHA_BASE_URL: baseUrl } });
  const out = await routerFor(provider, []).send(message);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'DELIVERY_UNCERTAIN');
  assert.equal(redirectedRequests, 0);
});
