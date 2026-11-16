/** Capture actual application components against fictional fixtures only. Never contacts a production API. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const target = process.argv[2] || await fs.mkdtemp(path.join(os.tmpdir(), 'pf-help-captures-'));
await fs.mkdir(target, { recursive: true });
const app = express();
app.get('/runtime-config.js', (_req, res) => res.type('js').send('window.__PF_RUNTIME_CONFIG__={};'));
app.get('/__help-practice', (_req, res) => res.type('html').send('<!doctype html><html lang="es" data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Práctica PF con datos ficticios</title><link rel="stylesheet" href="/styles/fonts.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/operations-modern.css"><link rel="stylesheet" href="/staff/service-briefing.css"></head><body class="operations-shell"><main class="container" id="fixture"><h1>Práctica · datos ficticios</h1><div id="practice"></div></main><script type="module" src="/__help-practice.js"></script></body></html>'));
app.get('/__help-practice.js', (_req, res) => res.type('js').send(`
import {mountServiceOperations} from '/staff/service-operations.js';
import {initialRehearsal,applyRehearsalAction} from '/staff/rehearsal-model.js';
const config={program_type:'VISIT',program_json:{points_per_visit:10},branch_id:'demo-branch',rewards:[{id:'demo-coffee',name:'Café de práctica',points_cost:50,active:true,available:true,stock:10}],observed_at:'2026-11-16T12:00:00Z'};
let session=null;
const api=async(url,options={})=>{if(url.endsWith('/briefing'))return {briefing:{id:'demo',version:1,acknowledged:true,payload:{rules:{rate:10,program_type:'VISIT'},offers:[],unavailable_rewards:[],cases:[]}}};if(options.method==='POST'){const body=JSON.parse(options.body);if(url.endsWith('/rehearsal'))session={id:'demo-session',version:1,state:initialRehearsal(config)};else session={...session,version:session.version+1,state:applyRehearsalAction(session.state,body)};}return {session,current:true,readiness:{blockers:[]}};};
mountServiceOperations({container:document.querySelector('#practice'),api});
`));
app.use('/negocio', express.static(path.join(root, 'public/merchant')));
app.use(express.static(path.join(root, 'public')));
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, colorScheme: 'light', serviceWorkers: 'block' });
 const unexpected = [];
 await page.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== origin || url.pathname.startsWith('/api/')) { unexpected.push(url.pathname); return route.abort(); } return route.continue(); });
 const scenes = [{slug:'recompensas',route:'recompensas'}, {slug:'clientes',route:'clientes'}, {slug:'personal',route:'personal'}];
 const captures=[];
 for (const scene of scenes) {
  await page.goto(`${origin}/negocio/?demo=1&vista=libre#${scene.route}`);
  await page.locator('#contenido h1').waitFor(); await page.evaluate(() => document.fonts.ready);
  const main = await page.locator('#contenido').boundingBox(); const heading = await page.locator('#contenido h1').boundingBox();
  const last = await page.getByText('¿Necesitas ayuda?', { exact: false }).last().boundingBox();
  const clip = { x: main.x, y: heading.y - 12, width: main.width, height: Math.min(780, last.y - heading.y + 42) };
  await page.screenshot({ path: path.join(target, `${scene.slug}.png`), clip });
  captures.push({ file: `${scene.slug}.png`, origin: `/negocio/?demo=1&vista=libre#${scene.route}`, description:'Actual PF interface with built-in fictional demonstration data; crop excludes navigation and blank layout space.' });
 }
 await page.goto(`${origin}/__help-practice`);await page.getByText('Practicar el recorrido completo',{exact:true}).click();
 await page.getByRole('button',{name:'Iniciar práctica guardada',exact:true}).click();
 await page.getByRole('button',{name:'Simular inscripción',exact:true}).click();
 await page.getByRole('button',{name:'Comprobar intento no elegible',exact:true}).click();
 await page.getByLabel('Visitas ficticias',{exact:true}).fill('5');
 await page.getByRole('button',{name:'Registrar compra ficticia',exact:true}).click();
 await page.getByText('Cliente ficticio · 50 puntos',{exact:true}).waitFor();
 await page.locator('#fixture').screenshot({path:path.join(target,'practica.png')});
 captures.push({file:'practica.png',origin:'public/staff/service-operations.js + public/staff/rehearsal-model.js',description:'Actual saved-practice component rendered with a local in-memory API fixture; fictional customer, no real network or storage operations.'});
 if (unexpected.some(p=>p.startsWith('/api/'))) throw new Error(`Unexpected API requests: ${unexpected.join(', ')}`);
 await fs.writeFile(path.join(target,'captures.json'),JSON.stringify(captures,null,2)+'\n');
 console.log(target);
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
