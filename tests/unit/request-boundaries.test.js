import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { defaultRequestBody, errorHandler } from '../../src/middleware/common.js';
import { isProbePath, requestComplexityLimit } from '../../src/middleware/request-boundaries.js';

test('only exact API probe paths can bypass global rate limits', () => {
  for (const path of ['/health', '/v1/ready', '/metrics']) assert.equal(isProbePath(path), true);
  for (const path of ['/staff/award?x=/api/health', '/public/api/health', '/staff/health', '/health-extra']) assert.equal(isProbePath(path), false);
});

test('deep and oversized JSON structures are rejected before schema validation', () => {
  function run(body) {
    let next = false, status = 0;
    requestComplexityLimit({ body }, { status(code) { status = code; return this; }, json() {} }, () => { next = true; });
    return { next, status };
  }
  assert.deepEqual(run({ awards: Array.from({ length: 200 }, () => ({ txId: 'x', amount_q: 15, items: 1, meta: { reference: 'x' } })) }), { next: true, status: 0 });
  assert.deepEqual(run({ awards: new Array(6000).fill(0) }), { next: false, status: 413 });
  let nested = {};
  for (let i = 0; i < 40; i++) nested = { child: nested };
  assert.deepEqual(run(nested), { next: false, status: 413 });
});

test('empty-body compatibility preserves parsed JSON, raw bytes and parser rejection', async () => {
  const app = express();
  app.use(express.json({ limit: '1mb', verify(req, _res, buffer) { Object.assign(req, { rawBody: buffer.toString('utf8') }); } }));
  app.use(defaultRequestBody, requestComplexityLimit);
  app.post('/body', (req, res) => res.json({ body: req.body, rawBody: req.rawBody }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const absent = await fetch(`${origin}/body`, { method: 'POST' });
    assert.equal(absent.status, 200);
    assert.deepEqual(await absent.json(), { body: {} });
    const raw = '{ "values": [1, true, null] }';
    const parsed = await fetch(`${origin}/body`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    assert.deepEqual(await parsed.json(), { body: { values: [1, true, null] }, rawBody: raw });
    const invalid = await fetch(`${origin}/body`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400);
    const error = await invalid.json();
    assert.equal(error.error, 'JSON invalido');
    assert.equal(error.code, 'BAD_JSON');
    const oversized = await fetch(`${origin}/body`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'a'.repeat(1024 * 1024) }) });
    assert.equal(oversized.status, 413);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
