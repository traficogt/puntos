// Isolated audience review. Every API result is synthetic; no PF/provider requests.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
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
const entry = `import React,{StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider,Container,createTheme} from '@mantine/core';
import '@mantine/core/styles.css';import '/src/styles.css';
import Audiences from '/src/Audiences.jsx';import GrowthCampaigns from '/src/GrowthCampaigns.jsx';
${theme}
const definition={window_days:90,include:{match:'all',rules:[{field:'purchase_count',operator:'gte',value:3}]},exclude:{match:'any',rules:[]}};
window.__segments=[{id:'fixture-segment',name:'Clientes frecuentes',version:1,definition,archived:false}];
window.__calls=[];window.__campaigns=[];window.__previewTotal=24;
const requests=new Map();const fail=(message,status=503)=>Object.assign(new Error(message),{status});
window.__fixtureApi=async(path,options={})=>{
 const url=new URL(path,location.origin),method=options.method||'GET',body=JSON.parse(options.body||'{}');window.__calls.push({path,method,body});
 if(url.pathname==='/api/admin/audiences/preview'){
  const total=window.__previewTotal;if(window.__delayPreview)await new Promise(resolve=>{window.__releasePreview=resolve;});
  if(window.__failPreview)throw fail('Vista previa no disponible.');
  return {total,contactable_count:Math.floor(total/2),generated_at:new Date().toISOString(),customers:total?[{id:'fixture-person',name:'Cliente sintético',purchase_count:3,spend_q:300,points_balance:100,marketing_opt_in:false}]:[]};
 }
 if(url.pathname==='/api/admin/audiences'&&method==='GET'){
  if(window.__failList)throw fail('Lista no disponible.');return {segments:structuredClone(window.__segments),total:window.__segments.length};
 }
 if(url.pathname==='/api/admin/audiences'&&method==='POST'){
  if(requests.has(body.request_id))return structuredClone(requests.get(body.request_id));
  const segment={...body,id:crypto.randomUUID(),version:1,archived:false};window.__segments.push(segment);requests.set(body.request_id,{segment});
  if(window.__dropCreate){window.__dropCreate=false;throw fail('Resultado sin confirmar.');}return structuredClone({segment});
 }
 if(url.pathname.startsWith('/api/admin/audiences/')&&method==='PUT'){
  const segment=window.__segments.find(value=>url.pathname.endsWith('/'+value.id));
  if(window.__concurrentEdit){window.__concurrentEdit=false;segment.version++;segment.name='Versión externa';}
  if(segment.version!==body.version)throw fail('La audiencia cambió en otra sesión. Recárgala antes de guardar.',409);
  Object.assign(segment,body,{version:segment.version+1});return structuredClone({segment});
 }
 if(url.pathname==='/api/admin/analytics/recovery/runs'){
  if(window.__failRecovery)throw fail('Recuperación no disponible.');return {runs:[{id:'fixture-run',name:'Lista anterior',member_count:20}]};
 }
 if(url.pathname==='/api/admin/growth-campaigns'&&method==='GET')return {campaigns:structuredClone(window.__campaigns),total:window.__campaigns.length,limit:20,offset:0};
 if(url.pathname==='/api/admin/growth-campaigns'&&method==='POST'){
  const segment=window.__segments.find(value=>value.id===body.audience_segment_id);
  if(segment&&(segment.version!==body.audience_segment_version||segment.archived))throw fail('La audiencia está archivada o cambió. Revisa su versión antes de crear la campaña.',409);
  const member_count=segment?Math.min(window.__previewTotal,body.audience_limit):20;
  const campaign={...body,id:crypto.randomUUID(),status:'draft',member_count,points_budget:null,starts_at:null,expires_at:null,
   audience_snapshot:segment?{segment_id:segment.id,segment_version:segment.version,name:segment.name,definition:structuredClone(segment.definition),cutoff:new Date().toISOString(),total:window.__previewTotal,selected_count:member_count,limit:body.audience_limit,overflow_count:Math.max(0,window.__previewTotal-member_count),contactable_count:12,selected_contactable_count:5}:null};
  window.__campaigns.push(campaign);return structuredClone({campaign});
 }
 if(url.pathname.startsWith('/api/admin/growth-campaigns/'))return {campaign:structuredClone(window.__campaigns.find(value=>url.pathname.endsWith('/'+value.id)))};
 throw fail('Unexpected fixture request: '+path);
};
const params=new URLSearchParams(location.search),Component=params.get('surface')==='growth'?GrowthCampaigns:Audiences;
const content=React.createElement(MantineProvider,{theme,forceColorScheme:params.get('theme')||'light'},React.createElement(Container,{size:'lg',py:'xl'},React.createElement(Component,{features:{analytics:true,campaign_rules:true},onDirty:value=>{window.__dirty=value;}})));
createRoot(document.getElementById('root')).render(params.has('strict')?React.createElement(StrictMode,null,content):content);`;
let vite, browser, origin;
before(async()=>{
 vite=await createServer({configFile:false,root,publicDir:false,logLevel:'error',plugins:[react(),{
  name:'isolated-audience-review',resolveId(id){if(id==='/__audience-entry.jsx')return '\0audience-entry';if(id==='/lib.js')return '\0audience-api';},
  load(id){if(id==='\0audience-entry')return entry;if(id==='\0audience-api')return 'export const api=(path,options)=>window.__fixtureApi(path,options);';},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
   if(assets.has(req.url)){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'font/woff2');res.end(assets.get(req.url));return;}
   if(!req.url?.startsWith('/negocio/'))return next();res.setHeader('Content-Type','text/html');
   res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/fonts.css"><title>Revisión de audiencias</title></head><body><main id="root"></main><script type="module" src="/__audience-entry.jsx"></script></body></html>'));
  });}
 }],server:{host:'127.0.0.1',port:0}});await vite.listen();origin='http://127.0.0.1:'+vite.httpServer.address().port;browser=await chromium.launch();
});
after(async()=>{await browser?.close();await vite?.close();});
async function pageFor(query='',flags={}){
 const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(6000);
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.push(request.url());});
 await page.addInitScript(flags=>Object.assign(window,flags),flags);await page.goto(origin+'/negocio/'+query);
 return {page,check:()=>{assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);}};
}
async function choose(page,label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}

test('audience refresh failure clears prior counts and changed criteria invalidate preview',async()=>{
 const {page,check}=await pageFor();try{
  await page.getByRole('button',{name:'Ver clientes que coinciden',exact:true}).click();await page.getByRole('heading',{name:'Vista previa de la audiencia'}).waitFor();
  await page.screenshot({path:'/tmp/pf-audiences-before.png',fullPage:true});
  await page.getByLabel('Incluir clientes que cumplan: valor 1',{exact:true}).fill('5');
  await page.getByText('Cambiaste las condiciones.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Vista previa de la audiencia'}).count(),0);
  await page.getByRole('button',{name:'Ver clientes que coinciden',exact:true}).click();await page.getByRole('heading',{name:'Vista previa de la audiencia'}).waitFor();
  await page.evaluate(()=>{window.__failPreview=true;});await page.getByRole('button',{name:'Ver clientes que coinciden',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Vista previa no disponible.'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Vista previa de la audiencia'}).count(),0,'A failed fresh query must not retain old counts');check();
 }finally{await page.close();}
});

test('archive locks editing until restore and stale saves recover without losing the draft',async()=>{
 const {page,check}=await pageFor();try{
  page.on('dialog',dialog=>dialog.accept());await page.getByRole('region',{name:'Tus audiencias',exact:true}).getByRole('button',{name:'Clientes frecuentes',exact:true}).click();
  await page.getByRole('button',{name:'Archivar audiencia',exact:true}).click();await page.getByRole('button',{name:'Restaurar audiencia',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Nombre de la audiencia',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Restaurar audiencia',exact:true}).click();await page.getByRole('button',{name:'Archivar audiencia',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Nombre de la audiencia',exact:true}).isEnabled(),true);
  await page.getByRole('textbox',{name:'Nombre de la audiencia',exact:true}).fill('Mi borrador');await page.evaluate(()=>{window.__concurrentEdit=true;});
  await page.getByRole('button',{name:'Guardar audiencia',exact:true}).click();await page.getByRole('alert').filter({hasText:/cambió en otra sesión/}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Nombre de la audiencia',exact:true}).inputValue(),'Mi borrador');
  await page.getByRole('button',{name:'Actualizar lista',exact:true}).click();await page.getByRole('button',{name:'Versión externa',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Nombre de la audiencia',exact:true}).inputValue(),'Versión externa');check();
 }finally{await page.close();}
});

test('StrictMode remounts still complete queries and lost create responses retry the same request',async()=>{
 const {page,check}=await pageFor('?strict=1',{__dropCreate:true});try{
  await page.getByRole('textbox',{name:'Nombre de la audiencia',exact:true}).fill('Nueva audiencia local');
  await page.getByRole('button',{name:'Guardar audiencia',exact:true}).click();await page.getByRole('alert').filter({hasText:'Resultado sin confirmar.'}).waitFor();
  await page.getByRole('button',{name:'Guardar audiencia',exact:true}).click();await page.getByText('Audiencia guardada.',{exact:false}).waitFor();
  const calls=await page.evaluate(()=>window.__calls.filter(value=>value.path==='/api/admin/audiences'&&value.method==='POST'));
  assert.equal(calls.length,2);assert.equal(calls[0].body.request_id,calls[1].body.request_id);assert.equal(await page.evaluate(()=>window.__segments.length),2);check();
 }finally{await page.close();}
});

test('segment campaigns survive recovery failure and display canonical persisted snapshot totals',async()=>{
 const {page,check}=await pageFor('?surface=growth',{__failRecovery:true});try{
  await choose(page,'Origen de los participantes','Audiencia con condiciones');await choose(page,'Audiencia guardada','Clientes frecuentes · Versión 1');
  await page.getByRole('textbox',{name:'Nombre de la campaña',exact:true}).fill('Oferta por audiencia');
  await page.getByRole('textbox',{name:/Máximo de clientes para esta oferta/}).fill('10');
  await page.getByText(/24 clientes coinciden/).waitFor();await page.getByText('La audiencia supera el límite elegido.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();await page.getByText(/10 participantes de 24 coincidencias al crearla/).waitFor();
  assert.equal((await page.evaluate(()=>window.__calls.find(value=>value.path==='/api/admin/growth-campaigns'&&value.method==='POST'))).body.audience_segment_version,1);
  await page.addScriptTag({path:path.join(root,'node_modules/axe-core/axe.min.js')});
  for(const mode of ['light','dark']){
   await page.setViewportSize({width:390,height:844});await page.evaluate(mode=>document.documentElement.setAttribute('data-mantine-color-scheme',mode),mode);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Campaign mobile overflow '+mode);
   const a11y=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}));assert.deepEqual(a11y.violations.map(value=>({id:value.id,targets:value.nodes.map(node=>node.target)})),[]);
   await page.screenshot({path:'/tmp/pf-audience-campaign-'+mode+'.png',fullPage:true});
  }check();
 }finally{await page.close();}
});

test('campaign audience refresh handles count changes, failed preview and saved version conflicts',async()=>{
 const {page,check}=await pageFor('?surface=growth');try{
  await choose(page,'Origen de los participantes','Audiencia con condiciones');await choose(page,'Audiencia guardada','Clientes frecuentes · Versión 1');await page.getByText(/24 clientes coinciden/).waitFor();
  await page.evaluate(()=>{window.__failPreview=true;});await page.getByRole('button',{name:'Actualizar coincidencias',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'No se pudo consultar la audiencia.'}).waitFor();assert.equal(await page.getByText(/24 clientes coinciden/).count(),0);
  await page.evaluate(()=>{window.__failPreview=false;window.__previewTotal=30;});await page.getByRole('button',{name:'Reintentar vista previa',exact:true}).click();await page.getByText(/30 clientes coinciden/).waitFor();
  await page.getByRole('textbox',{name:'Nombre de la campaña',exact:true}).fill('Conservar mi borrador');
  await page.evaluate(()=>{window.__segments[0].version=2;});await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();await page.getByRole('alert').filter({hasText:/archivada o cambió/}).waitFor();
  await page.getByRole('button',{name:'Actualizar audiencias',exact:true}).click();await page.getByRole('region',{name:'Preparar una oferta',exact:true}).getByText('Clientes frecuentes · Versión 2',{exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Nombre de la campaña',exact:true}).inputValue(),'Conservar mi borrador');
  await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();await page.getByText(/Versión 2.*30 participantes de 30 coincidencias/).waitFor();check();
 }finally{await page.close();}
});

test('long saved names and audience controls fit mobile light/dark with accessible preview regions',async()=>{
 const {page,check}=await pageFor();try{
  await page.getByRole('region',{name:'Tus audiencias',exact:true}).getByRole('button',{name:'Clientes frecuentes',exact:true}).click();await page.getByRole('textbox',{name:'Nombre de la audiencia',exact:true}).fill('Audiencia'.repeat(11));
  await page.getByRole('button',{name:'Guardar audiencia',exact:true}).click();await page.getByText('Audiencia guardada.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Ver clientes que coinciden',exact:true}).click();await page.getByRole('heading',{name:'Vista previa de la audiencia'}).waitFor();
  await page.addScriptTag({path:path.join(root,'node_modules/axe-core/axe.min.js')});
  for(const mode of ['light','dark']){
   await page.setViewportSize({width:390,height:844});await page.evaluate(mode=>document.documentElement.setAttribute('data-mantine-color-scheme',mode),mode);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile overflow '+mode);
   const a11y=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}));assert.deepEqual(a11y.violations.map(value=>({id:value.id,targets:value.nodes.map(node=>node.target)})),[]);
   await page.screenshot({path:'/tmp/pf-audiences-'+mode+'.png',fullPage:true});
  }check();
 }finally{await page.close();}
});


test('late preview responses cannot replace a newer saved version or its empty result',async()=>{
 const {page,check}=await pageFor('?surface=growth');try{
  await choose(page,'Origen de los participantes','Audiencia con condiciones');await choose(page,'Audiencia guardada','Clientes frecuentes · Versión 1');await page.getByText(/24 clientes coinciden/).waitFor();
  await page.evaluate(()=>{window.__delayPreview=true;});await page.getByRole('button',{name:'Actualizar coincidencias',exact:true}).click();await page.waitForFunction(()=>typeof window.__releasePreview==='function');
  await page.evaluate(()=>{window.__segments[0].version=2;window.__previewTotal=0;window.__delayPreview=false;});await page.getByRole('button',{name:'Actualizar audiencias',exact:true}).click();
  await page.getByText(/0 clientes coinciden/).waitFor();await page.getByText(/Necesitas al menos 10 participantes/).waitFor();
  await page.evaluate(async()=>{window.__releasePreview();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(undefined))));});
  assert.equal(await page.getByText(/24 clientes coinciden/).count(),0);check();
 }finally{await page.close();}
});

test('audience list failures remain distinct from an empty list and empty preview',async()=>{
 const {page,check}=await pageFor('',{__failList:true});try{
  await page.getByRole('alert').filter({hasText:'No pudimos cargar esta información'}).waitFor();assert.equal(await page.getByText(/Aún no hay audiencias guardadas/).count(),0);
  await page.evaluate(()=>{window.__failList=false;window.__segments=[];window.__previewTotal=0;});await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.getByText(/Aún no hay audiencias guardadas/).waitFor();
  await page.getByRole('button',{name:'Ver clientes que coinciden',exact:true}).click();await page.getByText(/No hay coincidencias/).waitFor();assert.equal(await page.getByRole('region',{name:'Muestra de clientes de la audiencia',exact:true}).count(),0);check();
 }finally{await page.close();}
});
