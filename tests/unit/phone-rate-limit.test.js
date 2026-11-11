import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitByPhone } from '../../src/middleware/rate-limit.js';

async function attempt(middleware, phone) {
  let status = 200;
  await middleware({ body: { phone } }, { set: () => {} }, error => { status = error?.statusCode ?? 200; });
  return status;
}

test('phone limiter supports distinct scoped counters while preserving shared legacy default callers', async () => {
  const request = rateLimitByPhone(1, 60000, { keyPrefix: 'phone:test-request:' });
  const verify = rateLimitByPhone(2, 120000, { keyPrefix: 'phone:test-verify:' });
  const legacy = rateLimitByPhone(1, 60000);
  const sameLegacy = rateLimitByPhone(1, 60000);
  const phone = '50255559813';
  assert.equal(await attempt(request, phone), 200);
  assert.equal(await attempt(request, '+502 5555-9813'), 429);
  assert.equal(await attempt(verify, phone), 200);
  assert.equal(await attempt(verify, '+502 5555-9813'), 200);
  assert.equal(await attempt(verify, phone), 429);
  assert.equal(await attempt(legacy, phone), 200);
  assert.equal(await attempt(sameLegacy, '+502 5555-9813'), 429);
});
