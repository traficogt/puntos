import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const routerRequire = createRequire(require.resolve('expo-router/package.json'));

test('Expo Router receives the CommonJS query API and can round-trip customer deep links', () => {
  const query = routerRequire('query-string');
  assert.equal(typeof query.stringify, 'function');
  assert.equal(typeof query.parse, 'function');
  const encoded = query.stringify({ negocio: 'café', destino: '/qr', filtro: 'a+b' });
  assert.deepEqual({ ...query.parse(encoded) }, { negocio: 'café', destino: '/qr', filtro: 'a+b' });
});
