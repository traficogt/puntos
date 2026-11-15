import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function worker(response) {
  const handlers = new Map(), writes = [], removed = [];
  const store = { put: async (key) => writes.push(key), match: async () => undefined };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed source fixture.
  const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    URL, Response,
    self: {
      location: { origin: 'https://fixture.invalid' },
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: { claim: async () => {} }
    },
    caches: {
      open: async () => store,
      keys: async () => ['pf-v50', 'pf-v51'],
      delete: async (key) => removed.push(key)
    },
    fetch: async () => response
  });
  return { handlers, writes, removed };
}

test('all server-accepted API case variants bypass every worker caching branch', async () => {
  const { handlers, writes } = worker(new Response('private'));
  for (const path of ['/api', '/API', '/api/', '/API/customer/me', '/aPi/v1/customer/me', '/Api?test=1']) {
    for (const destination of ['document', 'script', '']) {
      let intercepted = false;
      handlers.get('fetch')({
        request: { method: 'GET', url: 'https://fixture.invalid' + path, destination, mode: destination === 'document' ? 'navigate' : 'cors' },
        respondWith: () => { intercepted = true; }
      });
      assert.equal(intercepted, false, `${path} / ${destination} must use direct network`);
    }
  }
  assert.deepEqual(writes, []);
});

test('private and no-store response directives prevent shared caching in both strategies', async () => {
  for (const directive of ['no-store', 'private', 'public, max-age=60, No-StOrE', 'private="Set-Cookie", max-age=120']) {
    for (const path of ['/asset.js', '/asset.txt']) {
      const { handlers, writes } = worker(new Response('private', { headers: { 'Cache-Control': directive } }));
      let pending;
      handlers.get('fetch')({
        request: { method: 'GET', url: 'https://fixture.invalid' + path, mode: 'cors', destination: '' },
        respondWith: result => { pending = result; }
      });
      assert.equal(await (await pending).text(), 'private', 'online response remains available');
      assert.deepEqual(writes, [], directive);
    }
  }
});

test('ordinary public assets still cache and activation removes the old privacy-affected generation', async () => {
  const { handlers, writes, removed } = worker(new Response('public', { headers: { 'Cache-Control': 'public, max-age=60' } }));
  let pending;
  handlers.get('fetch')({ request: { method: 'GET', url: 'https://fixture.invalid/public.js', mode: 'cors', destination: 'script' }, respondWith: value => { pending = value; } });
  await pending;
  assert.equal(writes.length, 1);
  handlers.get('activate')({ waitUntil: value => { pending = value; } });
  await pending;
  assert.deepEqual(removed.sort(), ['pf-v50', 'pf-v51']);
});
