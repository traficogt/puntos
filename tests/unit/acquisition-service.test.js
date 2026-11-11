import test from 'node:test';
import assert from 'node:assert/strict';

test('source links are canonical, tenant-owned and never arbitrary URLs', async () => {
  const { acquisitionSourceUrl, sourceInputSchema } = await import('../../src/app/services/acquisition-service.js');
  const business = { id: 'own', slug: 'café uno' };
  assert.equal(acquisitionSourceUrl(business, 'https://puntos.example/path', { business_id: 'own', code: 'abcdefghijklmnop' }), 'https://puntos.example/registro/caf%C3%A9%20uno?origen=abcdefghijklmnop');
  assert.throws(() => acquisitionSourceUrl(business, 'https://puntos.example', { business_id: 'other', code: 'abcdefghijklmnop' }));
  assert.throws(() => acquisitionSourceUrl(business, 'https://puntos.example', { business_id: 'own', code: 'https://outside.test' }));
  for (const input of [{ name: '' }, { name: ' A ', branch_id: 'foreign' }, { name: 'A', url: 'https://outside.test' }, { name: 'A', business_id: 'other' }]) assert.equal(sourceInputSchema.safeParse(input).success, false);
  assert.equal(sourceInputSchema.parse({ name: ' Mostrador ', request_id: '11111111-1111-4111-8111-111111111111' }).name, 'Mostrador');
});
