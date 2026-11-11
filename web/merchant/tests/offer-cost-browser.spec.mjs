// Synthetic API fixtures exercise the real form and preflight. No PF writes.
/* eslint-disable security/detect-non-literal-fs-filename -- fixed repository assets and local verification artifact paths */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const artifacts = '/var/lib/puntos/releases/merchant-evidence-20261111/cost-browser';
const main = await readFile(path.join(root, 'src/main.jsx'), 'utf8');
const theme = main.slice(main.indexOf('const theme = createTheme('), main.indexOf('class ErrorBoundary'));
const assets = new Map([['/styles/fonts.css', await readFile(path.resolve(root, '../../public/styles/fonts.css'))]]);
for (const name of (await readdir(path.resolve(root, '../../public/fonts'))).filter(name => name.endsWith('.woff2'))) assets.set(`/fonts/${name}`, await readFile(path.resolve(root, '../../public/fonts', name)));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {MantineProvider,Container,createTheme} from '@mantine/core';
import '@mantine/core/styles.css';import '/src/styles.css';
import GrowthCampaigns from '/src/GrowthCampaigns.jsx';
${theme}
window.__calls=[];window.__campaigns=[];
const definition={window_days:90,include:{match:'all',rules:[{field:'joined_days',operator:'gte',value:0}]},exclude:{match:'any',rules:[]}};
window.__fixtureApi=async(path,options={})=>{
 const url=new URL(path,location.origin),method=options.method||'GET',body=JSON.parse(options.body||'{}');window.__calls.push({path:url.pathname,method,body});
 if(url.pathname==='/api/admin/analytics/recovery/runs')return {runs:[{id:'run',name:'Lista guardada',member_count:20}]};
 if(url.pathname==='/api/admin/audiences')return {segments:[{id:'segment',name:'Todos',version:1,definition}]};
 if(url.pathname==='/api/admin/audiences/preview'){if(window.__failAudience)throw new Error('Audience failed');return {total:10,contactable_count:6,generated_at:new Date().toISOString()};}
 if(url.pathname==='/api/admin/reward-economics'){if(window.__failEconomics)throw new Error('Economics failed');return {currency:'GTQ',settings:{cost_per_point_q:window.__savedCost??0.1,gross_margin_pct:35}};}
 if(url.pathname==='/api/admin/growth-campaigns'&&method==='GET')return {campaigns:window.__campaigns,total:window.__campaigns.length};
 if(url.pathname==='/api/admin/growth-campaigns'&&method==='POST'){
  const campaign={...body,id:'created',status:'draft',offer_kind:'experiment',member_count:20,preparation_status:'ready',points_committed:0,points_remaining:body.points_budget};
  window.__campaigns.push(campaign);return {campaign};
 }
 if(url.pathname.endsWith('/preflight'))return {preflight:{id:'preflight',can_activate:true,expires_at:new Date(Date.now()+600000).toISOString(),maximum_commitment_points:300,maximum_incentive_cost_q:30,treatment_count:16,control_count:4,currency:'GTQ',contacts:{eligible_now:12},stacking:{maximum_targeted_bonus_per_purchase:50},warnings:[],blockers:[],...window.__preflight}};
 if(url.pathname==='/api/admin/growth-campaigns/created')return {campaign:window.__campaigns[0]};
 throw new Error('Unexpected request: '+path);
};
const query=new URLSearchParams(location.search);
createRoot(document.getElementById('root')).render(React.createElement(MantineProvider,{theme,forceColorScheme:query.get('theme')||'light'},React.createElement(Container,{size:'lg',py:'xl'},React.createElement(GrowthCampaigns,{features:{analytics:true,campaign_rules:true},onDirty:()=>{}}))));`;
let vite, browser, origin;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  vite = await createServer({ configFile: false, root, publicDir: false, logLevel: 'error', plugins: [react(), {
    name: 'isolated-offer-cost',
    resolveId(id) { if (id === '/__cost-entry.jsx') return '\0cost-entry'; if (id === '/lib.js') return '\0cost-api'; },
    load(id) { if (id === '\0cost-entry') return entry; if (id === '\0cost-api') return 'export const api=(path,options)=>window.__fixtureApi(path,options);'; },
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (assets.has(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(assets.get(req.url)); return; }
      if (!req.url?.startsWith('/negocio/')) return next();
      res.setHeader('Content-Type', 'text/html');res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/fonts.css"><title>Costos de ofertas</title></head><body><main id="root"></main><script type="module" src="/__cost-entry.jsx"></script></body></html>'));
    }); },
  }], server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();origin = `http://127.0.0.1:${vite.httpServer.address().port}`;browser = await chromium.launch();
});
after(async () => { await browser?.close();await vite?.close(); });
async function pageFor(width = 1200, theme = 'light') {
  const page = await browser.newPage({ viewport: { width, height: 950 } });page.setDefaultTimeout(5000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.goto(`${origin}/negocio/?theme=${theme}`);
  return { page, check: () => { assert.deepEqual(errors, []);assert.deepEqual(requests, []); } };
}
async function choose(page, label, option) { await page.getByRole('combobox', { name: label, exact: true }).click();await page.getByRole('option', { name: option, exact: true }).click(); }

test('copies saved assumptions explicitly, submits the converted point budget, and keeps scenarios outside activation terms', async () => {
  const { page, check } = await pageFor();
  try {
    await page.getByRole('heading', { name: 'Costo y límite de esta oferta', exact: true }).waitFor();
    const pointCost = page.getByLabel('Costo estimado de cada punto (GTQ)', { exact: true });
    assert.equal(await pointCost.inputValue(), '');
    await choose(page, 'Lista de recuperación', 'Lista guardada · 20 clientes');
    await page.getByRole('textbox', { name: /^Nombre de la campaña/ }).fill('Prueba de costo');
    await page.getByRole('button', { name: 'Consultar mis supuestos guardados', exact: true }).click();
    await page.getByRole('button', { name: 'Usar costo guardado en esta oferta', exact: true }).click();
    assert.equal(await pointCost.inputValue(), '0.1');
    await page.getByRole('button', { name: 'Calcular un límite desde un importe', exact: true }).click();
    await page.getByLabel('Importe disponible para el bono (GTQ)', { exact: true }).fill('12.99');
    const apply = page.getByRole('button', { name: 'Aplicar límite de 100 puntos', exact: true });
    await apply.focus();await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('Límite total de puntos extra', { exact: true }).inputValue(), '100');
    await pointCost.fill('0.04');
    await page.getByText('Cambiaste el costo o el bono después de calcular el límite.', { exact: false }).waitFor();
    assert.equal(await page.getByLabel('Límite total de puntos extra', { exact: true }).inputValue(), '100');
    await page.getByRole('button', { name: 'Aplicar límite de 300 puntos', exact: true }).click();
    await page.getByRole('button', { name: 'Explorar un escenario de canje', exact: true }).click();
    await page.getByLabel('Puntos extra que se canjearían (%)', { exact: true }).fill('25');
    await page.getByText(/75 puntos · costo supuesto:/).waitFor();
    await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
    await page.getByRole('heading', { name: 'Comprobar antes de activar', exact: true }).waitFor();
    const created = await page.evaluate(() => window.__calls.find(row => row.method === 'POST' && row.path === '/api/admin/growth-campaigns').body);
    assert.equal(created.points_budget, 300);assert.equal(created.estimated_cost_per_point_q, 0.04);
    assert.equal(Object.hasOwn(created, 'redemption_percent'), false);
    await page.getByText('Estimación si se canjean todos los puntos extra:', { exact: false }).last().waitFor();
    check();
  } finally { await page.close(); }
});

test('does not convert unknown or zero cost and clears stale audience counts after failed refresh', async () => {
  const { page, check } = await pageFor();
  try {
    await choose(page, 'Origen de los participantes', 'Audiencia con condiciones');
    await choose(page, 'Audiencia guardada', 'Todos · Versión 1');
    await page.getByText('Hasta 8 bonos completos', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Calcular un límite desde un importe', exact: true }).click();
    await page.getByLabel('Importe disponible para el bono (GTQ)', { exact: true }).fill('10');
    await page.getByText('Ingresa un costo por punto conocido para calcular el límite.', { exact: true }).waitFor();
    await page.getByLabel('Costo estimado de cada punto (GTQ)', { exact: true }).fill('0');
    await page.getByText('Con costo cero, el importe no define un límite. Elige el límite de puntos directamente.', { exact: true }).waitFor();
    await page.evaluate(() => { window.__failAudience = true; });
    await page.getByRole('button', { name: 'Actualizar coincidencias', exact: true }).click();
    await page.getByText('Falta una audiencia vigente o un límite de puntos para calcular el compromiso.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Hasta 8 bonos completos', { exact: false }).count(), 0);
    check();
  } finally { await page.close(); }
});

test('optional margin needs entered assumptions and the cost workspace fits mobile and both themes with accessible controls', async () => {
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    const { page, check } = await pageFor(width, theme);
    try {
      await choose(page, 'Lista de recuperación', 'Lista guardada · 20 clientes');
      await page.getByLabel('Costo estimado de cada punto (GTQ)', { exact: true }).fill('0.1');
      await page.getByRole('button', { name: 'Ilustrar margen de una compra', exact: true }).click();
      assert.equal(await page.getByText('Margen ilustrativo después del bono:', { exact: false }).count(), 0);
      await page.getByLabel('Importe de la compra del ejemplo (GTQ)', { exact: true }).fill('40');
      await page.getByLabel('Margen bruto supuesto para el ejemplo (%)', { exact: true }).fill('30');
      await page.getByText(/Margen ilustrativo después del bono:.*7\.00/).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations);
      await writeFile(path.join(artifacts, `axe-${width}-${theme}.json`), JSON.stringify(violations, null, 2));
      assert.deepEqual(violations, []);
      await page.getByRole('region', { name: 'Costo y límite de esta oferta', exact: true }).screenshot({ path: path.join(artifacts, `cost-${width}-${theme}.png`) });
      check();
    } finally { await page.close(); }
  }
});


test('final approval rounds subcent GTQ and zero-decimal CLP exposure upward', async () => {
  for (const {currency,rate,points,formatted} of [
    {currency:'GTQ',rate:0.000001,points:800,formatted:'Q 0.01'},
    {currency:'CLP',rate:0.002,points:100,formatted:'CLP 1'},
  ]) {
    const {page,check}=await pageFor();
    try {
      await page.evaluate(({currency,rate,points})=>{window.__preflight={currency,maximum_commitment_points:points,maximum_incentive_cost_q:points*rate,cost_assumptions:{per_point_q:rate}};},{currency,rate,points});
      await choose(page,'Lista de recuperación','Lista guardada · 20 clientes');
      await page.getByRole('textbox',{name:/^Nombre de la campaña/}).fill('Comprobación de redondeo');
      await page.getByLabel('Costo estimado de cada punto (GTQ)',{exact:true}).fill(String(rate));
      await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();
      await page.getByRole('heading',{name:'Comprobar antes de activar',exact:true}).waitFor();
      const text=await page.getByText('Estimación si se canjean todos los puntos extra:',{exact:false}).textContent();
      assert.ok(text.replace(/\s+/g,' ').includes(formatted),text);
      await page.getByText('El importe se redondea hacia arriba a la unidad mínima de '+currency+'.',{exact:false}).waitFor();
      check();
    } finally {await page.close();}
  }
});
