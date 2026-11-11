import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevProvider } from '../../src/app/services/messaging/providers/dev-provider.js';

test('development delivery cannot claim success in production', async () => {
  const provider = createDevProvider({ environment: 'production' });
  assert.equal(provider.canSend(), false);
  await assert.rejects(provider.send({ channel: 'verify', body: 'test' }), /production/i);
});
