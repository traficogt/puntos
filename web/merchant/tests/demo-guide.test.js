import test from 'node:test';
import assert from 'node:assert/strict';
import { demoView, demoLocation, guideSteps } from '../src/demo-guide.js';

test('new visitors choose a path; explicit screen links keep full exploration', () => {
  assert.equal(demoView(new URL('https://pf.test/demostracion/')), 'inicio');
  assert.equal(demoView(new URL('https://pf.test/demostracion/#recuperar-clientes')), 'libre');
  assert.equal(demoView(new URL('https://pf.test/demostracion/?vista=invalid#costos')), 'libre');
  assert.equal(demoView(new URL('https://pf.test/demostracion/?vista=guia#ofertas')), 'guia');
});

test('guide URLs preserve browser demo mode and use canonical Spanish sections', () => {
  assert.equal(demoLocation(new URL('https://pf.test/negocio/?demo=1&utm_source=owner#recovery'), 'growth', 'guia'), '/negocio/?demo=1&utm_source=owner&vista=guia#ofertas');
  assert.equal(demoLocation(new URL('https://pf.test/demostracion/?vista=guia#ofertas'), 'growth', 'libre'), '/demostracion/?vista=libre#ofertas');
  assert.deepEqual(guideSteps.map(step => step.page), ['recovery', 'growth', 'economics']);
});
