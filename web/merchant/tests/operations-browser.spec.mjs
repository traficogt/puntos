// Isolated UI fixture: all operations evidence is synthetic; no PF/provider calls.
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
import Operations from '/src/Operations.jsx';
import {demoOperations} from '/src/demo-operations.js';
${theme}
window.__operationCalls=[];
window.__operationsApi=async(path,options={})=>{
 window.__operationCalls.push([path,options.method||'GET']);
 if(window.__failOperations)throw new Error('Fixture unavailable');
 if(window.__unknownOperations)return {generated_at:new Date().toISOString(),summary:{attention_count:0,setup_count:0,unknown_count:1},next_actions:[],sections:[{id:'google_wallet',title:'Google Wallet',state:'unknown',summary:'No hay evidencia disponible.',metrics:[],reasons:[],last_observed_at:null}]};
 if(window.__emptyOperations)return {generated_at:new Date().toISOString(),summary:{attention_count:0,setup_count:0,unknown_count:0},next_actions:[],sections:[]};
 return demoOperations();
};
createRoot(document.getElementById('root')).render(React.createElement(MantineProvider,{theme},React.createElement(Container,{size:'lg',py:'xl'},React.createElement(Operations))));`;
const vite = await createServer({ configFile:false,root,publicDir:false,logLevel:'error',plugins:[react(),{
 name:'isolated-operations-check',
 resolveId(id){if(id==='/__operations-entry.jsx')return '\0operations-entry.jsx';if(id==='/lib.js')return '\0operations-api';},
 load(id){if(id==='\0operations-entry.jsx')return entry;if(id==='\0operations-api')return 'export const api=(path,options)=>window.__operationsApi(path,options);';},
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(assets.has(req.url)){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(assets.get(req.url));return;}
  if(!req.url?.startsWith('/negocio/'))return next();
  res.setHeader('Content-Type','text/html');
  res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/fonts.css"><title>Comprobación de operación</title></head><body><main id="root"></main><script type="module" src="/__operations-entry.jsx"></script></body></html>'));
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
 await page.getByRole('heading',{name:'Estado de la operación',exact:true}).waitFor();
 await page.screenshot({path:'/tmp/pf-operations-desktop.png',fullPage:true});
 await page.getByRole('heading',{name:'Qué revisar primero',exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Revisar devoluciones de caja',exact:true}).getAttribute('href'),'#conectar-caja');
 assert.equal(await page.getByRole('link',{name:'Revisar mensajes de automatizaciones',exact:true}).getAttribute('href'),'#automatizaciones');
 assert.equal(await page.getByRole('link',{name:'Completar costos de recompensas',exact:true}).getAttribute('href'),'#costos');
 await page.getByRole('heading',{name:'Costos de recompensas',exact:true}).waitFor();
 await page.getByRole('button',{name:'Ver registros de Mensajes de campañas y automatizaciones',exact:true}).click();
 await page.getByRole('columnheader',{name:'Automatizaciones',exact:true}).waitFor();
 await page.getByText('Plazo de confirmación vencido: el envío puede haber ocurrido. Revisa el proveedor antes de reenviar. (1)',{exact:true}).waitFor();
 await page.addScriptTag({path:path.join(root,'node_modules/axe-core/axe.min.js')});
 const a11y=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
 assert.deepEqual(a11y.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
 await page.screenshot({path:'/tmp/pf-operations-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/pf-operations-mobile.png',fullPage:true});
 const mobileA11y=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}));
 assert.deepEqual(mobileA11y.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
 await page.emulateMedia({colorScheme:'dark'});
 await page.evaluate(()=>document.documentElement.setAttribute('data-mantine-color-scheme','dark'));
 await page.screenshot({path:'/tmp/pf-operations-mobile-dark.png',fullPage:true});
 const darkA11y=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
 assert.deepEqual(darkA11y.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
 await page.evaluate(()=>{window.__failOperations=true;});
 await page.getByRole('button',{name:'Actualizar estado',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'No pudimos cargar esta información'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Qué revisar primero',exact:true}).count(),0);
 await page.evaluate(()=>{window.__failOperations=false;window.__emptyOperations=true;});
 await page.getByRole('button',{name:'Reintentar',exact:true}).click();
 await page.getByText('No hay áreas de operación disponibles para evaluar.',{exact:true}).waitFor();
 assert.equal(await page.getByText('Sin incidencias registradas.',{exact:true}).count(),0);
 await page.evaluate(()=>{window.__emptyOperations=false;window.__unknownOperations=true;});
 await page.getByRole('button',{name:'Actualizar estado',exact:true}).click();
 await page.getByText('Revisa las áreas por configurar o confirmar antes de interpretar este panel.',{exact:true}).waitFor();
 assert.equal(await page.getByText('Sin incidencias registradas.',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.__operationCalls.every(([,method])=>method==='GET')),true);
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 console.log('Operations browser: ranked links, source breakdown, honest empty/error states, desktop/mobile and accessibility passed; only synthetic read calls.');
}finally{await browser.close();await vite.close();}
