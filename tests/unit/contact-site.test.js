import test from 'node:test';
import assert from 'node:assert/strict';
import { contactSite } from '../../src/utils/contact-site.js';

test('Pertenece inquiries use the owner-confirmed inbox and brand', () => {
  assert.deepEqual(contactSite('pertenecegt.com', 'pf@example.com'), {
    name: 'Pertenece', domain: 'pertenecegt.com', to: 'hola@pertenecegt.com'
  });
});

test('PF and other hosts preserve the configured PF contact destination', () => {
  for (const host of ['puntosfieles.com', 'app.puntosfieles.com', 'localhost:3001', undefined]) {
    assert.deepEqual(contactSite(host, 'pf@example.com'), {
      name: 'PuntosFieles', domain: 'puntosfieles.com', to: 'pf@example.com'
    });
  }
});
