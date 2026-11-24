// Isolated browser fixture; no API, production records or provider requests.
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
assert.ok(existsSync(path.join(root, 'src/FirstPurchaseReturns.jsx')), 'The return-cohort report must exist');
const main = await readFile(path.join(root, 'src/main.jsx'), 'utf8');
const theme = main.slice(main.indexOf('const theme = createTheme('), main.indexOf('class ErrorBoundary'));
const fontRoot = path.resolve(root, '../../public/fonts');
const assets = new Map([['/styles/fonts.css', await readFile(path.resolve(root, '../../public/styles/fonts.css'))]]);
for (const name of (await readdir(fontRoot)).filter(name => name.endsWith('.woff2'))) assets.set(`/fonts/${name}`, await readFile(path.join(fontRoot, name)));
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider,Container,Stack,Title,Button,createTheme} from '@mantine/core';import '@mantine/core/styles.css';import '/src/styles.css';import FirstPurchaseReturns from '/src/FirstPurchaseReturns.jsx';${theme}
import Overview from '/src/Overview.jsx';import {demoApi} from '/src/demo-api.js';
import {demoFirstPurchaseReturns} from '/src/demo-first-purchase-returns.js';
window.__firstCalls=[];window.__firstMode='normal';window.__firstApi=async(path)=>{
  window.__firstCalls.push(path);
  const url=new URL(path,location.origin),mode=window.__firstMode;
  if(url.pathname!=='/api/admin/analytics/first-purchase-returns'){
    if(url.pathname==='/api/admin/analytics/overview' && mode==='delayOverview') await new Promise(resolve=>window.__releaseOverview=resolve);
    if(url.pathname==='/api/admin/analytics/overview' && mode==='errorOverview') throw new Error('Overview unavailable');
    return demoApi(path);
  }
  const d=demoFirstPurchaseReturns(url);
  if(mode==='delay') await new Promise(resolve=>window.__releaseFirst=resolve);
  if(mode==='error') throw new Error('Fixture unavailable');
  if(mode==='stale')d.data_readiness={inactivity_allowed:false,summary:'Faltan compras por sincronizar.'};
  return d;
};
function App(){const[branch,setBranch]=useState(null);if(new URL(location.href).searchParams.has('overview'))return React.createElement(MantineProvider,{theme},React.createElement(Container,{size:'lg',py:'xl'},React.createElement(Overview,{features:{analytics:true,multi_branch:true},onNavigate:()=>{}})));return React.createElement(MantineProvider,{theme},React.createElement(Container,{size:'lg',py:'xl'},React.createElement(Stack,{gap:'xl'},React.createElement(Title,{order:1},'Resumen de prueba'),React.createElement(Button,{onClick:()=>setBranch('10000000-0000-4000-8000-000000000001')},'Sucursal de prueba'),React.createElement(FirstPurchaseReturns,{branchId:branch}))));}createRoot(document.getElementById('root')).render(React.createElement(App));`;
const vite = await createServer({ configFile: false, root, publicDir: false, logLevel: 'error', plugins: [react(), {
  name: 'isolated-first-purchase-returns',
  resolveId(id) { if (id === '/__first-entry.jsx') return '\0first-entry.jsx'; if (id === '/lib.js') return '\0first-api'; },
  load(id) { if (id === '\0first-entry.jsx') return entry; if (id === '\0first-api') return 'export const api=(path)=>window.__firstApi(path);'; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (assets.has(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(assets.get(req.url)); return; }
    if (!req.url?.startsWith('/negocio/')) return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/fonts.css"><title>Seguimiento de canjes</title></head><body><main id="root"></main><script type="module" src="/__first-entry.jsx"></script></body></html>'));
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } }), errors = [], apiRequests = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/negocio/`);
  await page.getByRole('heading', { name: 'De la primera compra a la segunda', exact: true }).waitFor();
  await page.getByText('4 de 20 ya registraron otra compra.', { exact: true }).waitFor();
  await page.getByText(/Todavía no hay clientes con 30 días completos/).waitFor();
  const choose = async label => {
    await page.getByRole('combobox', { name: 'Semana de la primera compra', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  await choose('Desde el 5 oct 2026');
  await page.getByText('8 de 20 volvieron a comprar (40%).', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cómo se cuentan las primeras compras y los regresos', exact: true }).click();
  await page.getByText(/No prueban que el programa causó el regreso/).waitFor();
  await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
  const captures = path.resolve(root, '../../.impeccable/review/first-purchase-returns');
  await mkdir(captures, { recursive: true });
  for (const scheme of ['light', 'dark']) for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(value => document.documentElement.setAttribute('data-mantine-color-scheme', value), scheme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`);
    const axe = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
    assert.deepEqual(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
    await page.screenshot({ path: path.join(captures, `${width}-${scheme}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Sucursal de prueba', exact: true }).click();
  await page.getByText('4 de 10 volvieron a comprar (40%).', { exact: true }).waitFor();
  await page.getByText('Primera compra en la sucursal seleccionada; regreso en cualquier sucursal del negocio.', { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => window.__firstCalls)).at(-1).includes('branch_id=10000000-0000-4000-8000-000000000001'));
  await choose('Desde el 12 oct 2026');
  await page.getByText('2 de 5 volvieron a comprar (40%).', { exact: true }).waitFor();
  await page.getByText('1 de 5 ya registraron otra compra.', { exact: true }).waitFor();
  await page.evaluate(() => { window.__firstMode = 'delay'; });
  await choose('Desde el 5 oct 2026');
  await page.getByRole('status').filter({ hasText: 'Consultando primeras compras' }).waitFor();
  assert.equal(await page.getByText('2 de 5 volvieron a comprar (40%).', { exact: true }).count(), 0);
  await page.evaluate(() => { window.__firstMode = 'normal'; });
  await choose('Desde el 9 nov 2026');
  await page.getByText('2 de 10 ya registraron otra compra.', { exact: true }).waitFor();
  await page.evaluate(() => window.__releaseFirst());
  // The completed response for the older, canceled selection must not replace this one.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByText('4 de 10 volvieron a comprar (40%).', { exact: true }).count(), 0);
  await choose('Desde el 1 dic 2025');
  await page.getByText('No hay primeras compras registradas en esta semana.', { exact: true }).waitFor();
  await page.evaluate(() => { window.__firstMode = 'error'; });
  await page.getByRole('button', { name: 'Actualizar primeras compras', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No pudimos cargar esta información' }).waitFor();
  assert.equal(await page.getByText('No hay primeras compras registradas en esta semana.', { exact: true }).count(), 0);
  await page.evaluate(() => { window.__firstMode = 'stale'; });
  await choose('Desde el 9 nov 2026');
  await page.getByRole('alert').filter({ hasText: 'Datos incompletos' }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('alert').filter({ hasText: 'Sin conexión' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Actualizar primeras compras', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('combobox', { name: 'Semana de la primera compra', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  assert.equal(await page.getByRole('button', { name: 'Actualizar primeras compras', exact: true }).isDisabled(), false);
  // Mount the actual parent: its unrelated period reload must not reset the cohort.
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/negocio/?overview=1`);
  // The Overview keeps this report behind its "Ver análisis detallado" disclosure; open it as an owner would.
  await page.getByRole('button', { name: 'Ver análisis detallado', exact: true }).click();
  await page.getByRole('heading', { name: 'De la primera compra a la segunda', exact: true }).waitFor();
  await choose('Desde el 5 oct 2026');
  await page.getByText('8 de 20 volvieron a comprar (40%).', { exact: true }).waitFor();
  await page.evaluate(() => { window.__firstMode='delayOverview'; });
  await page.getByRole('combobox', { name: 'Período', exact: true }).click();
  await page.getByRole('option', { name: 'Últimos 7 días', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Consultando resultados' }).waitFor();
  assert.equal(await page.getByText('8 de 20 volvieron a comprar (40%).', { exact: true }).count(),1);
  await page.evaluate(() => {window.__firstMode='normal';window.__releaseOverview();});
  await page.getByRole('status').filter({ hasText: 'Consultando resultados' }).waitFor({state:'hidden'});
  const branchSelect=page.getByRole('combobox',{name:'Sucursal',exact:true});
  await branchSelect.click();
  await page.getByRole('option').nth(1).click();
  await page.getByText('4 de 10 volvieron a comprar (40%).', { exact: true }).waitFor();
  const latest=await page.evaluate(()=>window.__firstCalls.filter(path=>path.startsWith('/api/admin/analytics/first-purchase-returns')).at(-1));
  assert.ok(latest.includes('week_start=2026-10-05') && latest.includes('branch_id='));
  await page.evaluate(()=>{window.__firstMode='errorOverview';});
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  // The overview's own failure sits outside the disclosure; the detail panels inside it report their own loads.
  await page.getByRole('alert').filter({hasText:'No pudimos cargar esta información'}).and(page.locator(':not(.mantine-Accordion-root *)')).waitFor();
  await page.getByText('4 de 10 volvieron a comprar (40%).', { exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
  console.log('First purchase report: weekly/branch scopes, mature/open denominators, stale requests, empty/error/offline states, light/dark and axe passed.');
} finally { try { await browser?.close(); } finally { await vite.close(); } }
