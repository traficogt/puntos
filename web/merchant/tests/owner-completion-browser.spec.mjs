// Real isolated PostgreSQL writes; fixture observations only, no provider/customer messages.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import * as decision from '../../../src/app/services/merchant-decisions-service.js';
import * as templates from '../../../src/app/services/operating-template-service.js';
import {getIssuedCommitments} from '../../../src/app/services/reward-commitment-service.js';
import {previewCampaignCollisions} from '../../../src/app/services/campaign-collision-service.js';
const url=process.env.OWNER_OPERATIONS_TEST_DB_URL;assert.ok(url,'Run owner-operations integration fixture first, then supply OWNER_OPERATIONS_TEST_DB_URL');
const parsed=new URL(url);assert.equal(parsed.pathname,'/owner_operations_test');assert.notEqual(parsed.port,'5432');assert.equal(parsed.hostname,'127.0.0.1');
const db=new pg.Pool({connectionString:url});const b=(await db.query("SELECT id FROM businesses WHERE slug='owner'")).rows[0].id;
const owner=(await db.query("SELECT * FROM staff_users WHERE business_id=$1 AND role='OWNER'",[b])).rows[0],staff=(await db.query("SELECT * FROM staff_users WHERE business_id=$1 AND role='MANAGER'",[b])).rows[0];
const campaign=(await db.query("SELECT * FROM growth_campaigns WHERE business_id=$1 AND status='draft' LIMIT 1",[b])).rows[0];
const deps={query:db.query.bind(db),getPlanFeatureOverrides:async()=>({}),getOwnerOutcomeEvidence:async()=>null,getOperationsHealth:async()=>({sections:[{id:'messaging',state:'needs_attention',title:'Mensajes pendientes',summary:'Un envío incierto requiere atención.',metrics:[{value:1}],action:{href:'#ofertas',label:'Revisar ofertas'}}]}),transaction:async fn=>{const c=await db.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}};
const actor={businessId:b,staffId:owner.id,staff:owner};
const root=path.resolve(import.meta.dirname,'..'),main=await readFile(path.join(root,'src/main.jsx'),'utf8'),theme=main.slice(main.indexOf('const theme = createTheme('),main.indexOf('class ErrorBoundary'));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider,Container,Stack,createTheme} from '@mantine/core';import '@mantine/core/styles.css';import '/src/styles.css';import Decisions from '/src/Decisions.jsx';import IssuedCommitments from '/src/IssuedCommitments.jsx';import CollisionPreview from '/src/CollisionPreview.jsx';${theme}\ncreateRoot(document.getElementById('root')).render(React.createElement(MantineProvider,{theme},React.createElement(Container,{size:"lg",py:"xl"},React.createElement(Stack,{gap:"xl"},React.createElement(Decisions),React.createElement(IssuedCommitments),React.createElement(CollisionPreview,{campaign:${JSON.stringify({id:campaign.id,minimum_purchase_q:5})}})))));`;
let apiCalls=0;
async function handle(req){const pathname=new URL(req.url,'http://fixture.test').pathname;let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):{};apiCalls++;
 if(pathname==='/api/admin/decisions')return decision.getDecisionInbox({businessId:b},deps);
 if(pathname==='/api/admin/decisions/review')return decision.reviewDecision({...actor,input},deps);
 if(pathname.startsWith('/api/admin/decisions/history/'))return decision.getDecisionHistory({...actor,decisionKey:pathname.split('/').at(-1)},deps);
 if(pathname==='/api/admin/decisions/operating-mode')return decision.setOperatingMode({...actor,input},deps);
 if(pathname==='/api/admin/decisions/templates')return templates.listOperatingTemplates(actor,deps);
 if(pathname==='/api/admin/decisions/templates/approve')return templates.approveOperatingTemplate({...actor,input},deps);
 if(pathname==='/api/admin/decisions/templates/trigger')return templates.triggerOperatingTemplate({...actor,input},deps);
 if(pathname==='/api/admin/decisions/templates/revoke')return templates.revokeOperatingTemplate({...actor,input},deps);
 if(pathname==='/api/admin/reward-economics/commitments')return getIssuedCommitments({businessId:b},db.query.bind(db));
 if(pathname.endsWith('/collision-preview'))return previewCampaignCollisions({businessId:b,campaignId:campaign.id,input},deps);
 throw new Error('Unexpected fixture endpoint '+pathname);
}
const vite=await createServer({configFile:false,root,publicDir:false,logLevel:'error',plugins:[react(),{name:'owner-db-browser',resolveId(id){if(id==='/__owner-entry.jsx')return '\0owner-entry.jsx';if(id==='/lib.js')return '\0owner-api';},load(id){if(id==='\0owner-entry.jsx')return entry;if(id==='\0owner-api')return `export async function api(path,options={}){const response=await fetch(path,{...options,headers:{'Content-Type':'application/json'}});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}`;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url.startsWith('/api/')){try{const out=await handle(req);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(out));}catch(error){res.statusCode=error.statusCode||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}return;}if(!req.url.startsWith('/negocio/'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner completion fixture</title></head><body><main id="root"></main><script type="module" src="/__owner-entry.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});
await vite.listen();const browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{});
try{const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/negocio/`);
 await page.getByRole('heading',{name:'Qué necesita tu atención'}).waitFor();await page.getByRole('combobox',{name:'Responsable de Mensajes pendientes'}).click();await page.getByRole('option',{name:'Ana · Gerente'}).click();await page.getByRole('button',{name:'Guardar responsable'}).click();await page.getByText('Responsable guardado.',{exact:false}).waitFor();
 assert.equal((await db.query('SELECT assigned_staff_id FROM merchant_decision_reviews WHERE business_id=$1',[b])).rows[0].assigned_staff_id,staff.id);
 await page.getByRole('button',{name:'Descartar con motivo'}).click();await page.getByLabel('Motivo del descarte',{exact:true}).fill('Resuelto por el proveedor en la prueba');await page.getByRole('button',{name:'Confirmar descarte'}).click();await page.getByText('Motivo guardado.',{exact:false}).waitFor();
 await page.getByRole('combobox',{name:'Mostrar pendientes'}).click();await page.getByRole('option',{name:'Descartados',exact:true}).click();await page.getByRole('button',{name:'Ver historial'}).click();await page.getByLabel('Historial del pendiente').getByText('Versión 2',{exact:false}).waitFor();
 await page.getByRole('combobox',{name:'Nuevo ritmo'}).click();await page.getByRole('option',{name:'Ocupado',exact:true}).click();await page.getByRole('button',{name:'Guardar ritmo'}).click();await page.getByText('Estado actual: Ocupado',{exact:false}).waitFor();
 assert.equal((await db.query('SELECT program_json FROM businesses WHERE id=$1',[b])).rows[0].program_json.merchant_operating_mode.mode,'busy');
 await page.getByRole('button',{name:'Comprobar compra de ejemplo'}).click();await page.getByText('Combinación compatible más generosa:',{exact:false}).waitFor();assert.equal(await page.getByRole('heading',{name:'Beneficios emitidos pendientes'}).count(),1);
 for(const width of [1280,390]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`/tmp/pf-owner-completion-${width}.png`,fullPage:true});}
 await page.addScriptTag({path:path.join(root,'node_modules/axe-core/axe.min.js')});const accessibility=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(accessibility.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);assert.deepEqual(errors,[]);assert.ok(apiCalls>10);console.log('Owner browser: assignment, dismissal/history, operating switch, commitments, collision sample persisted; 390/1280 widths and accessibility passed.');
}finally{await browser.close();await vite.close();await db.end();}
