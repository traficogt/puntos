import test from 'node:test';
import assert from 'node:assert/strict';
import { createMerchantApi } from '../src/api-contracts.ts';

test('merchant contracts retain the region request, payload and abort signal', async () => {
  const controller = new AbortController();
  const payload = { country: 'GT', currency: 'GTQ', timezone: 'America/Guatemala', version: 'a'.repeat(64), confirmed_currency: 'GTQ' };
  const response = { region: { ...payload, locale: 'es-GT', minorUnits: 2 }, version: 'b'.repeat(64) };
  const calls = [];
  const client = createMerchantApi(async (path, options) => { calls.push({ path, options }); return response; });
  assert.equal(await client.put('/api/admin/region', payload, { signal: controller.signal }), response);
  assert.deepEqual(calls, [{ path: '/api/admin/region', options: { signal: controller.signal, method: 'PUT', body: JSON.stringify(payload) } }]);
});

test('merchant reads retain transport errors and cancellation options', async () => {
  const error = Object.assign(new Error('Session changed'), { status: 401 });
  const controller = new AbortController();
  const client = createMerchantApi(async (path, options) => {
    assert.equal(path, '/api/admin/launch/program');
    assert.equal(options.signal, controller.signal);
    throw error;
  });
  await assert.rejects(client.get('/api/admin/launch/program', { signal: controller.signal }), actual => actual === error);
});
