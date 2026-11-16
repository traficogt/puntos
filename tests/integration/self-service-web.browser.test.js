/* eslint-disable no-script-url -- An unsafe fixture URL verifies that no executable incident link is rendered. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright';
import { createSelfServiceWeb } from '../../src/middleware/self-service-web.js';

test('status distinguishes live failures from stale data and renders safe incident text on mobile', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../../public', import.meta.url));
  const app = express(); app.use(createSelfServiceWeb(root)); app.use(express.static(root));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  let browser;
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve(undefined));
        server.closeAllConnections();
      });
    }
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const ids=['sitio','acceso','sistema','ayuda','soporte']; let mode='up';
  await page.route('https://raw.githubusercontent.com/**', route => {
    if(mode==='network') return route.abort();
    const at = new Date(Date.now()-(mode==='stale'?21*60000:0)).toISOString();
    return route.fulfill({json:{version:1,generatedAt:at,incidentsCheckedAt:at,components:ids.map(id=>({id,state:mode==='down'&&id==='sistema'?'down':'up',checkedAt:at})),incidents:[{title:'<img src=x onerror=alert(1)>',body:'Prueba de lectura segura',url:'javascript:alert(1)',state:'open',openedAt:at}]}});
  });
  await page.goto(`${origin}/estado`);
  await page.waitForFunction(()=>document.querySelector('#resumen')?.getAttribute('data-state')==='up');
  assert.equal(await page.locator('.service-row').count(),5);
  assert.equal(await page.locator('#incidents img, #incidents a').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  mode='down'; await page.locator('#refresh-status').click();
  await page.waitForFunction(()=>document.querySelector('#resumen')?.getAttribute('data-state')==='down');
  mode='stale'; await page.locator('#refresh-status').click();
  await page.waitForFunction(()=>document.querySelector('#resumen')?.getAttribute('data-state')==='unknown');
  assert.equal(await page.locator('.service-state[data-state="unknown"]').count(),5);
  mode='network'; await page.locator('#refresh-status').click();
  await page.waitForFunction(()=>document.querySelector('#fetch-note')?.hasAttribute('hidden')===false);
  assert.match(await page.locator('#fetch-note').innerText(),/no confirma una caída/);
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  assert.equal((await fetch(`${origin}/calculadora.html`,{redirect:'manual'})).status,308);
  assert.equal((await fetch(`${origin}/super/soporte`)).status,200);
  const helpRedirect = await fetch(`${origin}/ayuda`,{redirect:'manual'});
  assert.equal(helpRedirect.status,301); assert.equal(helpRedirect.headers.get('location'),'/ayuda/');
  for (const route of ['/ayuda/','/ayuda/caja/registrar-puntos/','/ayuda/search/search_index.json','/ayuda/sitemap.xml']) assert.equal((await fetch(origin+route)).status,200,route);
  const missing = await fetch(`${origin}/ayuda/no-existe/`);
  assert.equal(missing.status,404); assert.match(missing.headers.get('x-robots-tag'),/noindex/);
});
