import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createClient } from 'redis';

const url = process.env.DEPENDENCY_TEST_REDIS_URL;

test('Redis limits share counters, expire and survive reconnects; queued job payloads retain FIFO order', { skip: !url, timeout: 10000 }, async t => {
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Use a disposable loopback Redis fixture');
  const { checkRedisRateLimit } = await import('../../src/utils/redis-rate-limit.js');
  const first = createClient({ url, RESP: 2 });
  const second = createClient({ url, RESP: 2 });
  first.on('error', () => {});
  second.on('error', () => {});
  await first.connect();
  await second.connect();
  const prefix = `dependency-fixture:${randomUUID()}`;
  const key = `${prefix}:limit`, queue = `${prefix}:queue`;
  t.after(async () => {
    if (first.isOpen) { await first.del([key, queue]); await first.close(); }
    if (second.isOpen) await second.close();
  });
  assert.equal((await checkRedisRateLimit(first, key, 2, 1000)).remaining, 1);
  assert.equal((await checkRedisRateLimit(second, key, 2, 1000)).remaining, 0);
  assert.equal((await checkRedisRateLimit(first, key, 2, 1000)).allowed, false);
  assert.ok(await first.pTTL(key) > 0, 'The shared counter must have an expiry');
  await second.close();
  await second.connect();
  assert.equal((await checkRedisRateLimit(second, key, 2, 1000)).allowed, false);
  await setTimeout(1100);
  assert.equal((await checkRedisRateLimit(first, key, 2, 1000)).allowed, true);
  const firstJob = JSON.stringify({ id: 'stored-job-one' });
  const secondJob = JSON.stringify({ id: 'stored-job-two' });
  await first.lPush(queue, firstJob);
  await first.lPush(queue, secondJob);
  assert.equal(await second.rPop(queue), firstJob);
  assert.equal(await second.rPop(queue), secondJob);
});
