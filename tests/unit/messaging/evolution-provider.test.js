import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createMessageRouter } from '../../../src/app/services/messaging/message-router.js';

import { createEvolutionProvider } from '../../../src/app/services/messaging/providers/evolution-provider.js';
const message = { channel: 'verify', body: 'fixture message', destinations: { phone: '+50255555555' } };
const config = { EVOLUTION_API_KEY: 'fixture-key', EVOLUTION_INSTANCE: 'fixture / one', MESSAGE_PROVIDER_TIMEOUT_MS: 1000 };

async function fixture(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
}

function createProvider(options) {
  return createEvolutionProvider(options);
}

test('Evolution sends an authenticated v2 text request with an encoded instance and international digits', async t => {
  /** @type {{ path: string, headers: import('node:http').IncomingHttpHeaders, method: string, body: Record<string, unknown> } | null} */
  let request = null;
  const url = await fixture(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    request = { path: req.url, headers: req.headers, method: req.method, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: { id: 'fixture-id', remoteJid: '50255555555@s.whatsapp.net' }, status: 'PENDING' }));
  });
  const provider = createProvider({ config: { ...config, EVOLUTION_BASE_URL: `${url}/gateway` } });
  assert.equal(provider.canSend(message), true);
  const out = await provider.send(message);
  assert.ok(request);
  assert.equal(request.path, '/gateway/message/sendText/fixture%20%2F%20one');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.apikey, config.EVOLUTION_API_KEY);
  assert.deepEqual(request.body, { number: '50255555555', text: message.body });
  assert.equal(out.ok, true);
  assert.match(out.providerId, /^evolution:[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(out).includes('50255555555'));
});

test('Evolution requires an instance, key, safe URL and individual international number', async () => {
  const ready = { ...config, EVOLUTION_BASE_URL: 'https://example.invalid' };
  for (const patch of [{ EVOLUTION_API_KEY: '' }, { EVOLUTION_INSTANCE: '' }, { EVOLUTION_BASE_URL: '' }, { EVOLUTION_BASE_URL: 'https://secret@example.invalid' }]) {
    const provider = createProvider({ config: { ...ready, ...patch } });
    assert.equal(provider.canSend(message), false);
    await assert.rejects(provider.send(message), { message: 'MESSAGE_PROVIDER_NOT_READY' });
  }
  const provider = createProvider({ config: ready });
  assert.equal(provider.canSend({ destinations: { phone: '+50255555555@g.us' } }), false);
});

for (const mode of ['timeout', 'server-error', 'missing-id']) {
  test(`Evolution ${mode} suppresses fallback and does not leak upstream details`, async t => {
    let requests = 0;
    const url = await fixture(t, (_req, res) => {
      requests++;
      if (mode === 'timeout') { const timer = setTimeout(() => res.end('{"key":{"id":"late"}}'), 500); t.after(() => clearTimeout(timer)); return; }
      res.writeHead(mode === 'server-error' ? 500 : 201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: config.EVOLUTION_API_KEY, number: message.destinations.phone, text: message.body }));
    });
    let fallback = 0;
    const router = createMessageRouter({ order: ['evolution', 'fallback'], providers: {
      evolution: createProvider({ config: { ...config, EVOLUTION_BASE_URL: url, MESSAGE_PROVIDER_TIMEOUT_MS: mode === 'timeout' ? 150 : 1000 } }),
      fallback: { name: 'fallback', canSend: () => true, send: async () => { fallback++; return { ok: true }; } }
    } });
    const out = await router.send(message);
    assert.deepEqual(out, { ok: false, attempts: ['evolution'], error: 'DELIVERY_UNCERTAIN' });
    assert.equal(fallback, 0);
    assert.equal(requests, 1);
  });
}
