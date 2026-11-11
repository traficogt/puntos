import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { EventEmitter } from 'node:events';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const config = { teamId: 'ABCDEFGHIJ', keyId: 'KLMNOPQRST', topic: 'com.puntosfieles.customer', privateKey: keys.privateKey };

test('mobile push is opt-in, reads only enabled credentials, validates P-256, and pins production', async () => {
  const { loadMobilePushConfig } = await import('../../src/app/services/mobile-push/config.js');
  let reads = 0;
  const readFile = () => { reads++; return pem; };
  assert.deepEqual(loadMobilePushConfig({}, { readFile }), { enabled: false, ready: false, errors: [], config: null });
  assert.equal(reads, 0);
  const env = { MOBILE_PUSH_ENABLED: 'true', MOBILE_PUSH_APNS_TEAM_ID: config.teamId, MOBILE_PUSH_APNS_KEY_ID: config.keyId, MOBILE_PUSH_APNS_KEY_FILE: '/test/key.p8' };
  const good = loadMobilePushConfig(env, { readFile });
  assert.equal(good.ready, true); assert.equal(good.config.topic, config.topic);
  for (const patch of [{ MOBILE_PUSH_APNS_TEAM_ID: 'bad' }, { MOBILE_PUSH_APNS_KEY_ID: '' }, { MOBILE_PUSH_APNS_TOPIC: 'bad topic' }]) {
    const bad = loadMobilePushConfig({ ...env, ...patch }, { readFile });
    assert.equal(bad.ready, false); assert.equal(bad.config, null);
  }
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.equal(loadMobilePushConfig(env, { readFile: () => rsa }).ready, false);
  const unavailable = loadMobilePushConfig(env, { readFile: () => { throw Error('/test/key.p8 SECRET'); } });
  assert.equal(JSON.stringify(unavailable).includes('SECRET'), false);
});

function transport(replies) {
  const requests = [], sessions = [];
  return { requests, sessions, connect(host, options) {
    const session = Object.assign(new EventEmitter(), { destroyed: false, closed: false, close() { this.closed = true; }, destroy() { this.destroyed = true; }, request(headers) {
      const reply = replies.shift() || { status: 200 };
      const stream = Object.assign(new EventEmitter(), { close() { stream.emit('close'); }, end(body) {
        requests.push({ host, options, headers, body });
        if (reply.hang) return;
        queueMicrotask(() => {
          if (reply.error) return stream.emit('error', Error('raw token secret failure'));
          stream.emit('response', { ':status': reply.status });
          stream.emit('data', Buffer.from(reply.body || JSON.stringify({ reason: reply.reason })));
          stream.emit('end');
        });
      } });
      return stream;
    } });
    sessions.push(session); return session;
  } };
}

test('APNs signs cached ES256 JWT, pins production/topic, reuses connection, and bounds privacy', async () => {
  const { createApnsProvider } = await import('../../src/app/services/mobile-push/apns.js');
  const network = transport([]); let now = 1700000000000;
  const provider = createApnsProvider(config, { connect: /** @type {any} */ (network.connect), now: () => now });
  const input = { token: 'ab'.repeat(32), payload: { aps: { alert: { title: 'PuntosFieles', body: 'Tu tarjeta tiene novedades.' } } }, collapseId: 'card-test' };
  assert.deepEqual(await provider.send(input), { accepted: true, invalidToken: false, retryable: false, reason: 'Accepted' });
  await provider.send(input);
  assert.equal(network.sessions.length, 1);
  const first = network.requests[0];
  assert.equal(first.host, 'https://api.push.apple.com');
  assert.equal(first.headers['apns-topic'], config.topic);
  assert.equal(first.headers['apns-push-type'], 'alert');
  assert.equal(first.headers['apns-expiration'], '0');
  const jwt = first.headers.authorization.slice(7).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(jwt[0], 'base64url').toString()), { alg: 'ES256', kid: config.keyId });
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url').toString()).iss, config.teamId);
  assert.ok(verify('sha256', Buffer.from(jwt.slice(0, 2).join('.')), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url')));
  assert.equal(network.requests[1].headers.authorization, first.headers.authorization);
  now += 51 * 60000; await provider.send(input);
  assert.notEqual(network.requests[2].headers.authorization, first.headers.authorization);
  network.sessions[0].emit('goaway'); await provider.send(input);
  assert.equal(network.sessions.length, 2);
  provider.close();
});

test('APNs distinguishes invalid devices, configuration failures, retries, malformed and bounded responses', async () => {
  const { createApnsProvider } = await import('../../src/app/services/mobile-push/apns.js');
  const cases = [
    { status: 400, reason: 'BadDeviceToken', invalidToken: true },
    { status: 410, reason: 'Unregistered', invalidToken: true },
    { status: 410, reason: 'ExpiredToken', invalidToken: true },
    { status: 400, reason: 'DeviceTokenNotForTopic' },
    { status: 403, reason: 'InvalidProviderToken' },
    { status: 403, reason: 'ExpiredProviderToken', retryable: true },
    { status: 429, reason: 'TooManyRequests', retryable: true },
    { status: 500, reason: 'InternalServerError', retryable: true },
    { status: 503, body: 'secret arbitrary body', retryable: true },
    { status: 200, body: 'x'.repeat(9000), retryable: true },
    { error: true, retryable: true }, { hang: true, retryable: true }
  ];
  for (const expected of cases) {
    const network = transport([expected]);
    const provider = createApnsProvider(config, { connect: /** @type {any} */ (network.connect), timeoutMs: 10 });
    const result = await provider.send({ token: 'ab'.repeat(32), payload: { aps: { alert: 'Test' } } });
    assert.equal(result.accepted, false);
    assert.equal(result.invalidToken, expected.invalidToken || false);
    assert.equal(result.retryable, expected.retryable || false);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    provider.close();
  }
});
