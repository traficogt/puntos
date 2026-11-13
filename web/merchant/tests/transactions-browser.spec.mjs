// Isolated UI fixture: all transaction evidence is synthetic; no PF/provider calls.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const main = await readFile(path.join(root, 'src/main.jsx'), 'utf8');
const theme = main.slice(main.indexOf('const theme = createTheme('), main.indexOf('class ErrorBoundary'));
const fontRoot = path.resolve(root, '../../public/fonts');
const assets = new Map([['/styles/fonts.css', await readFile(path.resolve(root, '../../public/styles/fonts.css'))]]);
for (const name of (await readdir(fontRoot)).filter(name => name.endsWith('.woff2'))) assets.set(`/fonts/${name}`, await readFile(path.join(fontRoot, name)));
const entry = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider,Container,createTheme} from '@mantine/core';
import '@mantine/core/styles.css';
import '/src/styles.css';
import TransactionHistory from '/src/TransactionHistory.jsx';
import {demoTransactions} from '/src/demo-transactions.js';
${theme}
window.__transactionCalls=[];
window.__transactionsApi=async(path,options={})=>{
 window.__transactionCalls.push([path,options.method||'GET']);
 if(window.__failTransactions)throw new Error('Fixture unavailable');
 const url=new URL(path,'http://fixture');
 if(window.__emptyTransactions && url.pathname==='/api/admin/transaction-history')return {movements:[],next_cursor:null};
 if(url.pathname==='/api/admin/transaction-history')url.searchParams.set('limit','2');
 const result=await demoTransactions(url,options);
 if(result.explanation?.award)result.explanation.award.currency='GTQ';
 if(window.__preciseRate && result.explanation?.award){
   result.movement.points=2;const award=result.explanation.award;
   award.program.rate=0.015;award.base_points=2;award.program_points=2;award.awarded_points=2;
   award.rules[0].value=1.125;award.rules[0].points_before=2;award.rules[0].points_after=2.25;
 }
 if(window.__targetedTerms && result.explanation?.award){
   result.movement.points=25;const award=result.explanation.award;award.awarded_points=25;
   award.targeted_offer={bonus_points:7,campaign_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',criteria:{schema_version:1,clock:'database',evaluated_at:'2026-11-11T18:00:00.000001Z',minimum_purchase_q:15,starts_at:'2026-11-11T00:00:00.000000Z',expires_at:'2026-11-12T00:00:00.000000Z',points_budget:21,points_committed_before:7,points_committed_after:14,eligibility:{campaign_active:true,saved_membership:'treatment',unclaimed_before_award:true,customer_not_deleted:true,program_enabled_at_request:true,plan_features_allowed:true},purchase:{amount_q:90,visits:0,items:0,source:'online'}}};
 }
 return result;
};
createRoot(document.getElementById('root')).render(React.createElement(MantineProvider,{theme},React.createElement(Container,{size:'lg',py:'xl'},React.createElement(TransactionHistory))));`;
const vite = await createServer({ configFile:false,root,publicDir:false,logLevel:'error',plugins:[react(),{
 name:'isolated-transactions-check',
 resolveId(id){if(id==='/__transactions-entry.jsx')return '\0transactions-entry.jsx';if(id==='/lib.js')return '\0transactions-api';},
 load(id){if(id==='\0transactions-entry.jsx')return entry;if(id==='\0transactions-api')return 'export const api=(path,options)=>window.__transactionsApi(path,options);';},
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(assets.has(req.url)){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(assets.get(req.url));return;}
  if(!req.url?.startsWith('/negocio/'))return next();
  res.setHeader('Content-Type','text/html');
  res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/fonts.css"><title>Comprobación de operación</title></head><body><main id="root"></main><script type="module" src="/__transactions-entry.jsx"></script></body></html>'));
 });}
}],server:{host:'127.0.0.1',port:0}});
await vite.listen();
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[],requests=[];
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.push(request.url());});
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/negocio/`);
 await page.getByRole('heading',{name:'Movimientos y puntos',exact:true}).waitFor();
 await page.getByRole('button',{name:/Explicar Compra/}).first().click();
 await page.getByRole('heading',{name:'Detalle del movimiento',exact:true}).waitFor();
 await page.getByText('Cálculo guardado',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Detalle del movimiento');
 await page.getByText('De 9 a 18 puntos',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Ver reglas evaluadas',exact:true}).click();
 await page.getByText('Miércoles',{exact:true}).waitFor();
 await page.screenshot({path:'/tmp/pf-transactions-desktop.png',fullPage:true});
 await page.addScriptTag({path:path.join(root,'node_modules/axe-core/axe.min.js')});
 for(const width of [1200,390]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const a11y=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
   assert.deepEqual(a11y.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
 }
 await page.screenshot({path:'/tmp/pf-transactions-mobile.png',fullPage:true});
 await page.emulateMedia({colorScheme:'dark'});
 await page.evaluate(()=>document.documentElement.setAttribute('data-mantine-color-scheme','dark'));
 const dark=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
 assert.deepEqual(dark.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
 await page.screenshot({path:'/tmp/pf-transactions-mobile-dark.png',fullPage:true});
 await page.emulateMedia({colorScheme:'light'});
 await page.evaluate(()=>document.documentElement.setAttribute('data-mantine-color-scheme','light'));

 await page.evaluate(()=>{window.__targetedTerms=true;});
 await page.getByRole('button',{name:'Actualizar historial',exact:true}).click();
 await page.getByRole('heading',{name:'Condiciones guardadas de la oferta',exact:true}).waitFor();
 await page.getByText(/Compra mínima:.*15.00/).waitFor();
 await page.getByText(/Comprometidos antes: 7; después: 14/).waitFor();
 await page.getByText(/grupo guardado que recibe el bono/).waitFor();
 const offerA11y=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
 assert.deepEqual(offerA11y.violations.map(item=>item.id),[]);
 await page.screenshot({path:'/tmp/pf-targeted-offer-terms-mobile.png',fullPage:true});
 await page.evaluate(()=>{window.__targetedTerms=false;});
 await page.evaluate(()=>{window.__preciseRate=true;});
 await page.getByRole('button',{name:'Actualizar historial',exact:true}).click();
 await page.getByText(/0\.015 puntos por unidad de GTQ/).waitFor();
 await page.getByText('De 2 a 2.25 puntos',{exact:true}).waitFor();
 await page.evaluate(()=>{window.__preciseRate=false;});
 await page.getByRole('button',{name:'Volver al historial',exact:true}).click();
 await page.getByRole('button',{name:/Explicar Compra/}).nth(1).click();
 await page.getByText('Información parcial',{exact:true}).first().waitFor();
 await page.getByText(/No se guardaron las reglas evaluadas/).waitFor();
 assert.equal(await page.getByText('Cálculo guardado',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Ver reversión relacionada',exact:true}).click();
 await page.getByText(/La reversión de puntos no confirma/).waitFor();
 await page.getByRole('button',{name:'Volver al historial',exact:true}).click();
 const actionBox=await page.getByRole('button',{name:/Explicar Compra/}).first().boundingBox();
 assert.ok(actionBox.x>=0 && actionBox.x+actionBox.width<=390,'mobile history should expose its explanation action without horizontal scrolling');
 await page.screenshot({path:'/tmp/pf-transactions-history-mobile.png',fullPage:true});
 const listA11y=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
 assert.deepEqual(listA11y.violations.map(item=>item.id),[]);
 await page.getByRole('button',{name:'Más antiguos',exact:true}).click();
 await page.getByRole('button',{name:/Explicar Canje/}).waitFor();
 await page.getByRole('button',{name:'Más recientes',exact:true}).click();
 await page.getByRole('button',{name:/Explicar Compra/}).first().waitFor();
 await page.getByLabel('ID del movimiento').fill('invalid');
 await page.getByRole('button',{name:'Buscar movimiento',exact:true}).click();
 await page.getByText('Ingresa el ID completo del movimiento.',{exact:true}).waitFor();
 await page.getByLabel('ID del movimiento').fill('ffffffff-ffff-4fff-8fff-ffffffffffff');
 await page.getByRole('button',{name:'Buscar movimiento',exact:true}).click();
 await page.getByText('No se encontró ese movimiento en este negocio.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Volver al historial',exact:true}).click();
 await page.evaluate(()=>{window.__failTransactions=true;});
 await page.getByRole('button',{name:'Actualizar historial',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'No pudimos cargar esta información'}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Explicar Compra/}).count(),0);
 await page.evaluate(()=>{window.__failTransactions=false;window.__emptyTransactions=true;});
 await page.getByRole('button',{name:'Reintentar',exact:true}).click();
 await page.getByText('No hay movimientos en esta vista.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__transactionCalls.every(([,method])=>method==='GET')),true);
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 console.log('Transaction browser: exact/partial details, linked refund, pages, ID validation, empty/error states, desktop/mobile and accessibility passed.');
}finally{await browser.close();await vite.close();}
