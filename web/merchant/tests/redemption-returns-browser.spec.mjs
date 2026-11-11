// Isolated browser fixture; no API, production records or provider requests.
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
assert.ok(existsSync(path.join(root, 'src/RedemptionReturns.jsx')), 'The return-cohort report must exist');
const main = await readFile(path.join(root, 'src/main.jsx'), 'utf8');
const theme = main.slice(main.indexOf('const theme = createTheme('), main.indexOf('class ErrorBoundary'));
const fontRoot = path.resolve(root, '../../public/fonts');
const assets = new Map([['/styles/fonts.css', await readFile(path.resolve(root, '../../public/styles/fonts.css'))]]);
for (const name of (await readdir(fontRoot)).filter(name => name.endsWith('.woff2'))) assets.set(`/fonts/${name}`, await readFile(path.join(fontRoot, name)));
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider,Container,Stack,Title,Button,createTheme} from '@mantine/core';import '@mantine/core/styles.css';import '/src/styles.css';import RedemptionReturns from '/src/RedemptionReturns.jsx';${theme}
window.__returnCalls=[];window.__returnMode='normal';window.__returnApi=async(path)=>{window.__returnCalls.push(path);if(window.__returnMode==='delay')await new Promise(resolve=>window.__releaseReturns=resolve);if(window.__returnMode==='error')throw new Error('fixture');const url=new URL(path,location.origin),days=Number(url.searchParams.get('days')||90);const d={ok:true,generated_at:'2026-11-11T18:00:00Z',timezone:'America/Guatemala',scope:{branch_id:url.searchParams.get('branch_id')},cohort:{days,start:'2026-08-14T06:00:00Z',end:'2026-11-11T18:00:00Z',customers:42,legacy_timestamp_customers:2},follow_up:{days:30,definition:'later_local_day_within_720_hours'},completed:{customers:30,returned_customers:12,without_return_customers:18,return_rate_pct:40},ongoing:{customers:12,returned_customers:3},notes:[]};if(days!==90||window.__returnMode==='ongoing'){d.completed={customers:0,returned_customers:0,without_return_customers:0,return_rate_pct:null};d.cohort.customers=12;}if(window.__returnMode==='empty'){d.cohort.customers=0;d.cohort.legacy_timestamp_customers=0;d.completed={customers:0,returned_customers:0,without_return_customers:0,return_rate_pct:null};d.ongoing={customers:0,returned_customers:0};}return d;};
function App(){const[branch,setBranch]=useState(null);return React.createElement(MantineProvider,{theme},React.createElement(Container,{size:'lg',py:'xl'},React.createElement(Stack,{gap:'xl'},React.createElement(Title,{order:1},'Resumen de prueba'),React.createElement(Button,{onClick:()=>setBranch('10000000-0000-4000-8000-000000000001')},'Sucursal de prueba'),React.createElement(RedemptionReturns,{branchId:branch}))));}createRoot(document.getElementById('root')).render(React.createElement(App));`;
const vite = await createServer({ configFile: false, root, publicDir: false, logLevel: 'error', plugins: [react(), {
  name: 'isolated-redemption-returns',
  resolveId(id) { if (id === '/__return-entry.jsx') return '\0return-entry.jsx'; if (id === '/lib.js') return '\0return-api'; },
  load(id) { if (id === '\0return-entry.jsx') return entry; if (id === '\0return-api') return 'export const api=(path)=>window.__returnApi(path);'; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (assets.has(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(assets.get(req.url)); return; }
    if (!req.url?.startsWith('/negocio/')) return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/fonts.css"><title>Seguimiento de canjes</title></head><body><main id="root"></main><script type="module" src="/__return-entry.jsx"></script></body></html>'));
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } }), errors = [], apiRequests = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/negocio/`);
  await page.getByRole('heading', { name: 'Visitas después de canjear', exact: true }).waitFor();
  await page.getByText('12 de 30 clientes volvieron a comprar.', { exact: true }).waitFor();
  await page.getByText('40%', { exact: true }).waitFor();
  await page.getByText('3 de 12 ya registraron otra compra.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cómo se cuenta una visita posterior', exact: true }).click();
  await page.getByText(/No demuestra que la recompensa causó la visita/).waitFor();
  await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
  const captures = path.resolve(root, '../../.impeccable/review/redemption-returns');
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
  await page.getByRole('combobox', { name: 'Canjes del período', exact: true }).click();
  await page.getByRole('option', { name: 'Últimos 30 días', exact: true }).click();
  await page.getByText(/Todavía no hay clientes con 30 días completos/).waitFor();
  assert.equal(await page.getByText('40%', { exact: true }).count(), 0);
  assert.ok((await page.evaluate(() => window.__returnCalls)).at(-1).includes('days=30'));
  await page.getByRole('button', { name: 'Sucursal de prueba', exact: true }).click();
  await page.getByText('Sucursal seleccionada · canjes y compras posteriores', { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => window.__returnCalls)).at(-1).includes('branch_id=10000000-0000-4000-8000-000000000001'));
  await page.evaluate(() => { window.__returnMode = 'delay'; });
  await page.getByRole('button', { name: 'Actualizar seguimiento', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Consultando visitas posteriores' }).waitFor();
  assert.equal(await page.getByText('3 de 12 ya registraron otra compra.', { exact: true }).count(), 0);
  await page.evaluate(() => { window.__returnMode = 'empty'; window.__releaseReturns(); });
  await page.getByText('Aún no hay canjes válidos en este período.', { exact: true }).waitFor();
  await page.evaluate(() => { window.__returnMode = 'error'; });
  await page.getByRole('button', { name: 'Actualizar seguimiento', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No pudimos cargar esta información' }).waitFor();
  assert.equal(await page.getByText('Aún no hay canjes válidos en este período.', { exact: true }).count(), 0);
  await page.evaluate(() => { window.__returnMode = 'ongoing'; });
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.getByText('3 de 12 ya registraron otra compra.', { exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('alert').filter({ hasText: 'Sin conexión' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Actualizar seguimiento', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  assert.equal(await page.getByRole('button', { name: 'Actualizar seguimiento', exact: true }).isDisabled(), false);
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
  console.log('Return report: full denominator, ongoing/empty/loading/error/offline states, filters, 390/1200px, light/dark and axe passed.');
} finally { await browser.close(); await vite.close(); }
