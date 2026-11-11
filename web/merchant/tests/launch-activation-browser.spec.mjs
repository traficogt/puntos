// Local browser fixture: no database, production API or provider traffic.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import express from 'express';
import {chromium,expect} from '@playwright/test';
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture source, independent of request input.
const root=path.resolve(import.meta.dirname,'..'),source=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
const theme=source.slice(source.indexOf('const theme = createTheme('),source.indexOf('class ErrorBoundary'));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider,Container,createTheme} from '@mantine/core';${theme}
import '@mantine/core/styles.css';import '/src/styles.css';import Launch from '/src/Launch.jsx';import {demoRewardWorkspace} from '/src/demo-reward-workspace.js';import {demoLaunchProgram} from '/src/demo-launch.js';
const params=new URLSearchParams(location.search);window.__calls=[];window.__empty=params.has('empty');window.__fail=params.has('fail');window.__api=async(path,options={})=>{window.__calls.push({path,method:options.method||'GET'});
if(path==='/api/admin/launch/program'){if(params.has('delay')&&!window.__released)await new Promise(resolve=>window.__release=()=>{window.__released=true;resolve();});const result=demoLaunchProgram(options);if(params.has('invalid')&&!options.method)result.program.rate=0;return result;}
if(path==='/api/admin/reward-workspace'){if(params.has('delayRewards')&&!window.__releasedRewards)await new Promise(resolve=>window.__releaseRewards=()=>{window.__releasedRewards=true;resolve();});if(window.__fail)throw Error('Sin conexión');const result=demoRewardWorkspace(new URL(path,location.origin),options);if(window.__empty&&!options.method)result.rewards=[];if(params.has('branches')){const [a,b]=result.branches;const mode=params.get('branches'),mapping=(branch_id,state)=>({branch_id,enabled:true,inventory_required:true,quantity:1,inventory:{state,quantity:1,observedAt:new Date(Date.now()-1000).toISOString()}});result.rewards[0].branch_ids=mode==='scoped'?[a.id]:[a.id,b.id];result.rewards[0].mappings=mode==='unchecked'?[mapping(a.id,'stale')]:[mapping(a.id,mode==='scoped'?'stale':'available'),mapping(b.id,mode==='scoped'?'available':'stale')];}return result;}
if(path==='/api/admin/rewards')return {rewards:[]};
if(path==='/api/admin/customer-enrollment')return {business:{id:'business',name:'Café de práctica',slug:'cafe-practica'},registration_url:location.origin+'/registro/cafe-practica'};
if(path==='/api/admin/operations-health')return {next_actions:[]};throw Error('Petición inesperada: '+path);};
createRoot(document.getElementById('root')).render(React.createElement(MantineProvider,{theme,forceColorScheme:params.get('theme')||'light'},React.createElement(Container,{size:'lg',py:'xl'},React.createElement(Launch,{staff:{business_id:'business'},features:{},onDirty:value=>window.__dirty=value}))));`;
const vite=await createServer({configFile:false,root,logLevel:'error',plugins:[react(),{name:'launch-fixture',resolveId(id){if(id==='/__entry.jsx')return '\0launch-entry';if(id==='/lib.js')return '\0launch-api';},load(id){if(id==='\0launch-entry')return entry;if(id==='\0launch-api')return 'export const api=(path,options)=>window.__api(path,options);';},configureServer(server){server.middlewares.use('/fonts',express.static(path.join(root,'../../public/fonts')));server.middlewares.use('/styles',express.static(path.join(root,'../../public/styles')));server.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/negocio/'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/fonts.css"><title>Prepara tu programa</title></head><body><main id="root"></main><script type="module" src="/__entry.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});
await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`,browser=await chromium.launch();
try{
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
 async function audit(label){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');await page.addScriptTag({path:path.join(root,'node_modules/axe-core/axe.min.js')});const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[],label);await page.screenshot({path:'/tmp/pf-launch-'+label+'.png',fullPage:true});}
 await page.goto(origin+'/negocio/?empty=1');
 await expect(page.getByRole('tab',{name:'2. Recompensas',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('heading',{name:'Tu próximo paso',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Crear mi primera recompensa',exact:true})).toHaveAttribute('href','#recompensas');
 await page.getByRole('button',{name:'Guardar una regla de puntos',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('tab',{name:'1. Puntos',exact:true})).toHaveAttribute('aria-selected','true');await page.getByRole('tab',{name:'1. Puntos',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'2. Recompensas',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'Tu marca (opcional)',exact:true}).click();
 await page.getByRole('button',{name:'Recargar configuración',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Tu marca (opcional)',exact:true})).toHaveAttribute('aria-selected','true');
 for(const [mode,branch] of [['mixed','Local central'],['unchecked','Sucursal norte'],['scoped',null]]){
  await page.goto(origin+'/negocio/?branches='+mode);await page.getByRole('tab',{name:'2. Recompensas',exact:true}).click();
  await expect(page.getByText('Recompensas preparadas según la configuración consultada: '+(branch?1:0)+'.',{exact:true})).toBeVisible();
  if(branch){await expect(page.getByText('Según esta consulta, preparada en: '+branch+'.',{exact:true})).toBeVisible();await expect(page.getByText('La disponibilidad en las demás sucursales requiere revisión.',{exact:true})).toBeVisible();}
 }
 await page.goto(origin+'/negocio/?invalid=1');await expect(page.getByRole('tab',{name:'1. Puntos',exact:true})).toHaveAttribute('aria-selected','true');
 await page.goto(origin+'/negocio/?delay=1');await page.getByRole('tab',{name:'Tu marca (opcional)',exact:true}).click();await page.evaluate(()=>window.__release());await expect(page.getByRole('tab',{name:'Tu marca (opcional)',exact:true})).toHaveAttribute('aria-selected','true');
 await page.goto(origin+'/negocio/?delayRewards=1');await page.getByLabel('Puntos por GTQ',{exact:true}).fill('0.2');await expect.poll(()=>page.evaluate(()=>window.__dirty)).toBe(true);await page.evaluate(()=>window.__releaseRewards());await expect(page.getByRole('button',{name:'Preparar tu primera recompensa',exact:true})).toBeVisible();await expect(page.getByLabel('Puntos por GTQ',{exact:true})).toHaveValue('0.2');
 for(const mode of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:950});await page.goto(origin+'/negocio/?theme='+mode);
  await expect(page.getByRole('tab',{name:'3. Equipo y práctica',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('link',{name:'Crear accesos para mi equipo',exact:true})).toHaveAttribute('href','/administracion/?seccion=equipo');
  await expect(page.getByLabel('Recompensa para practicar')).toContainText('Café de la casa');await expect(page.getByLabel('Recompensa para practicar')).not.toContainText('Postre del día');
  const before=await page.evaluate(()=>window.__calls.length);
  await page.getByLabel('Compra de práctica (GTQ)',{exact:true}).fill('100');await page.getByRole('button',{name:'Registrar puntos ficticios',exact:true}).click();
  await expect(page.getByText('Cliente ficticio · 210 puntos',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Canjear en práctica',exact:true}).click();await expect(page.getByText('Cliente ficticio · 160 puntos',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Corregir canje ficticio',exact:true}).click();await expect(page.getByText('Cliente ficticio · 210 puntos',{exact:true})).toBeVisible();
  await expect(page.getByText('Práctica ficticia completada en esta sesión.',{exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>window.__calls.length),before,'practice must make no API calls');
  await audit('practice-'+width+'-'+mode);await page.getByRole('button',{name:'Reiniciar práctica',exact:true}).click();await expect(page.getByText('Cliente ficticio · 200 puntos',{exact:true})).toBeVisible();
  await expect(page.getByText('Práctica ficticia completada en esta sesión.',{exact:true})).not.toBeVisible();
  await page.getByRole('tab',{name:'2. Recompensas',exact:true}).click();await expect(page.getByText('Recompensas preparadas según la configuración consultada: 1.',{exact:true})).toBeVisible();
  await audit('rewards-'+width+'-'+mode);await page.getByRole('tab',{name:'4. QR y revisión',exact:true}).click();await expect(page.getByLabel('Enlace de inscripción')).toHaveValue(origin+'/registro/cafe-practica');await expect(page.getByRole('link',{name:'Registrar las pruebas en Mi piloto',exact:true})).toHaveCount(0);
 }
 await page.goto(origin+'/negocio/?fail=1');await expect(page.getByRole('tab',{name:'2. Recompensas',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('alert').filter({hasText:'No pudimos cargar esta información'})).toBeVisible();await expect(page.getByText('Catálogo sin consultar',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.__fail=false);await page.getByRole('button',{name:'Reintentar',exact:true}).click();await expect(page.getByText('Recompensas preparadas según la configuración consultada: 1.',{exact:true})).toBeVisible();
 await page.evaluate(async()=>{await window.__api('/api/admin/reward-workspace',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),reward:{name:'Primer premio guardado',description:null,points_cost:25,active:true,stock:null,valid_until:null,branch_ids:[]},available:true})});});
 await page.getByRole('button',{name:'Recargar configuración',exact:true}).click();await expect(page.getByText('Primer premio guardado',{exact:true})).toBeVisible();await expect(page.getByText('Recompensas preparadas según la configuración consultada: 2.',{exact:true})).toBeVisible();
 await expect(page.getByText('Costo de entrega desconocido en 1 recompensa preparada. No equivale a cero ni confirma rentabilidad.',{exact:true})).toBeVisible();
 assert.equal(await page.evaluate(()=>window.__calls.some(call=>call.path==='/api/admin/rewards')),false,'launch must read the same reward workspace that saves use');assert.deepEqual(errors,[]);
 console.log('Launch activation: saved prerequisite navigation, deliberate tab choice, shared reward fixture, paused exclusion, zero-call fictional practice/reset, error recovery, desktop/mobile light/dark and zero axe violations passed.');
}finally{await browser.close();await vite.close();}
