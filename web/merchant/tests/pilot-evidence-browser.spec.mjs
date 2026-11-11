// Local synthetic browser acceptance: no application database or provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import {chromium,expect} from '@playwright/test';
import {build} from 'vite';
const merchant=path.resolve(import.meta.dirname,'..'),project=path.resolve(merchant,'../..'),artifacts='/tmp/puntos-pilot-evidence-browser',outDir=path.join(artifacts,'build');
await fs.mkdir(artifacts,{recursive:true});
await build({root:merchant,configFile:path.join(merchant,'vite.config.js'),build:{outDir,emptyOutDir:true},logLevel:'warn'});
const app=express();app.use(helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:null}}}));
app.get('/demostracion/',(_q,res)=>res.sendFile(path.join(outDir,'index.html')));
app.get('/equipo/ingresar/',(_q,res)=>res.sendFile(path.join(project,'public/staff-login.html')));
app.get('/runtime-config.js',(_q,res)=>res.type('js').send('window.__PF_RUNTIME_CONFIG__={};'));
app.get('/test-axe.js',(_q,res)=>res.sendFile(path.join(merchant,'node_modules/axe-core/axe.min.js')));
app.use('/negocio',express.static(outDir));app.use(express.static(path.join(project,'public')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url());});
  await page.goto(`${origin}/demostracion/#preparar`);
  await page.getByRole('tab',{name:'4. QR y revisión',exact:true}).click();
  await expect(page.getByText(/Evidencia histórica: revisa cambios posteriores/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Descargar informe histórico'})).toBeVisible();
  await page.getByRole('link',{name:'Revisar el historial en Mi piloto',exact:true}).click();
  await page.getByLabel('Nombre del piloto').fill('Aceptación Odoo · fixture');
  await page.getByLabel('Este piloto incluye un sistema POS',{exact:true}).check();
  await page.getByLabel('Sistema POS probado').fill('Odoo');
  await page.getByRole('button',{name:'Iniciar piloto',exact:true}).click();
  assert.equal(await page.getByLabel('Versión exacta del POS').evaluate(input=>input.validity.valueMissing),true);
  await expect(page.getByRole('heading',{name:'Aceptación Odoo · fixture',exact:true})).toHaveCount(0);
  await page.getByLabel('Versión exacta del POS').fill('18.0');
  await page.getByLabel('Versión del módulo o adaptador',{exact:true}).fill('18.0.2.0.0');
  await page.getByRole('combobox',{name:'Alojamiento del POS',exact:true}).click();await page.getByRole('option',{name:'Servidor propio',exact:true}).click();
  await page.screenshot({path:path.join(artifacts,`profile-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Iniciar piloto',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Aceptación Odoo · fixture',exact:true})).toBeVisible();
  await expect(page.getByText(/Lista de pruebas · versión 2.*POS 18.0.*módulo 18.0.2.0.0/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Finalizar pruebas',exact:true})).toBeDisabled();
  const actions=await page.getByRole('button',{name:/^Registrar prueba:/}).allTextContents();assert.equal(actions.length,13);
  const labels=await page.getByRole('button',{name:/^Registrar prueba:/}).evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
  for(const label of labels){
   await page.getByRole('button',{name:label,exact:true}).click();
   await page.getByRole('combobox',{name:'Resultado de la prueba',exact:true}).click();await page.getByRole('option',{name:'Comprobado por el responsable',exact:true}).click();
   await page.getByLabel('Qué comprobaste',{exact:true}).fill('Comprobación ficticia; no acredita una instalación real.');
   await page.getByRole('button',{name:'Guardar prueba',exact:true}).click();await expect(page.getByRole('button',{name:'Guardar prueba',exact:true})).toHaveCount(0);
  }
  await expect(page.getByRole('button',{name:'Finalizar pruebas',exact:true})).toBeEnabled();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Finalizar pruebas',exact:true}).click();
  await expect(page.getByRole('button',{name:'Finalizar pruebas',exact:true})).toHaveCount(0);
  for(const mode of ['light','dark']){
   if(mode==='dark')await page.getByRole('button',{name:'Tema oscuro',exact:true}).click();
   await page.addScriptTag({url:`${origin}/test-axe.js`});
   const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations);
   await fs.writeFile(path.join(artifacts,`axe-pilot-${width}-${mode}.json`),JSON.stringify(violations,null,2));assert.deepEqual(violations,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(artifacts,`pilot-${width}-${mode}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Primer piloto de cafetería · ejemplo',exact:true}).click();await expect(page.getByText(/Lista de pruebas · versión 1/)).toBeVisible();
  const legacyRows=page.getByRole('region',{name:'Pruebas del piloto',exact:true}).getByRole('row');await expect(legacyRows).toHaveCount(10);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await context.close();
 }
 for(const role of [null,'MANAGER','STAFF']){
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),page=await context.newPage();
  await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==origin)return route.abort();return route.continue();});
  await context.route('**/api/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/api/staff/me')return route.fulfill(role?{json:{staff:{role,business_id:'fixture'}}}:{status:401,json:{error:'Expired',code:'AUTH_REQUIRED'}});
   if(p==='/api/staff/login')return route.fulfill({json:{staff:{role:'OWNER'}}});
   if(p==='/api/csrf')return route.fulfill({json:{csrfToken:'fixture'}});
   return route.fulfill({status:500,json:{error:'Unexpected fixture path'}});
  });
  await page.goto(`${origin}/negocio/#region`);
  if(role){
   await expect(page.getByRole('heading',{name:'Este panel es para propietarios',exact:true})).toBeVisible();
   await expect(page.getByRole('link',{name:role==='MANAGER'?'Abrir administración':'Abrir escáner',exact:true})).toHaveAttribute('href',role==='MANAGER'?'/administracion/':'/equipo/escaner/');
   await expect(page.getByRole('link',{name:'Ingresar con otra cuenta',exact:true})).toHaveAttribute('href','/equipo/ingresar/?return_to=%2Fnegocio%2F%23region');
  }else{
   await page.getByRole('link',{name:'Iniciar sesión',exact:true}).click();
   await page.getByRole('textbox',{name:'Correo electrónico',exact:true}).fill('owner@example.invalid');await page.getByLabel('Contraseña',{exact:true}).fill('fixture-password');
   await page.getByRole('button',{name:'Entrar al equipo',exact:true}).click();await page.waitForURL(`${origin}/negocio/#region`);
  }
  await context.close();
 }
 console.log('Pilot/access browser: historical launch, versioned profile, 13 checks and closure, legacy 9 checks, desktop/mobile/light/dark accessibility, role guidance and owner sign-in return passed. Synthetic data only.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
