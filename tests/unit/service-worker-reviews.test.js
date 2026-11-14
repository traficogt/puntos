import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('temporary review documents and images bypass browser offline caching', async () => {
  const handlers = new Map();
  const responses = [];
  const cache = { put: async () => {}, match: async () => undefined };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository worker fixture, never request input.
  const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    URL, Response,
    self: { location: { origin: 'https://puntosfieles.com' }, addEventListener: (name, handler) => handlers.set(name, handler) },
    caches: { open: async () => cache },
    fetch: async () => new Response('fixture', { status: 200 })
  });
  for (const prefix of ['/revision-ilustraciones/', '/revision-editorial/']) {
    for (const file of ['token/', 'token/gallery.css', 'token/image.webp']) {
      handlers.get('fetch')({
        request: { method: 'GET', url: 'https://puntosfieles.com' + prefix + file, mode: file.endsWith('/') ? 'navigate' : 'cors', destination: file.endsWith('.webp') ? 'image' : 'document' },
        respondWith: result => responses.push(result)
      });
    }
  }
  await Promise.all(responses);
  assert.equal(responses.length, 0, 'Review routes must use the network directly');
  handlers.get('fetch')({
    request: { method: 'GET', url: 'https://puntosfieles.com/styles.css', mode: 'cors', destination: 'style' },
    respondWith: result => responses.push(result)
  });
  await Promise.all(responses);
  assert.equal(responses.length, 1, 'Ordinary offline assets must retain their existing behavior');
});
