import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import {chromium,expect} from '@playwright/test';
import {build} from 'vite';
const merchant=path.resolve(import.meta.dirname,'..'),project=path.resolve(merchant,'../..'),artifacts='/tmp/puntos-owner-activation-browser',outDir=path.join(artifacts,'build');
await fs.mkdir(artifacts,{recursive:true});
await build({root:merchant,configFile:path.join(merchant,'vite.config.js'),build:{outDir,emptyOutDir:true,rollupOptions:{input:{main:path.join(merchant,'index.html'),ownerBrief:path.join(merchant,'tests/fixtures/owner-brief.html')}}},logLevel:'warn'});
const app=express();app.use(helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:null}}}));
app.get('/demostracion/',(_q,res)=>res.sendFile(path.join(outDir,'index.html')));
app.get('/runtime-config.js',(_q,res)=>res.type('js').send('window.__PF_RUNTIME_CONFIG__={};'));
app.get('/test-axe.js',(_q,res)=>res.sendFile(path.join(merchant,'node_modules/axe-core/axe.min.js')));
app.use('/negocio',express.static(outDir));app.use(express.static(path.join(project,'public')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url());});
  await page.goto(`${origin}/demostracion/#automatizaciones`);
  const second=page.locator('section[aria-labelledby="second-visit-heading"]'),brief=page.locator('section[aria-labelledby="owner-brief-heading"]');
  await expect(second.getByRole('heading',{name:'De la primera a la segunda visita',exact:true})).toBeVisible();
  await expect(second.getByRole('switch')).not.toBeChecked();
  await second.getByRole('button',{name:'Usar propuesta para revisar'}).click();await expect(second.getByLabel('Bono en la segunda compra',{exact:true})).toHaveValue('10');
  await second.getByRole('switch').check();await second.getByRole('button',{name:'Revisar antes de activar'}).click();await expect(second.getByText('Escribe una compra mínima. Usa 0 solo si no deseas un mínimo.')).toBeVisible();
  await second.getByLabel('Compra mínima (GTQ)',{exact:true}).fill('20');await second.getByRole('button',{name:'Revisar antes de activar'}).click();
  await expect(second.getByRole('heading',{name:'Revisa el compromiso antes de activar'})).toBeVisible();await expect(second.getByText(/Costo monetario desconocido/)).toBeVisible();
  await page.screenshot({path:path.join(artifacts,`review-${width}.png`),fullPage:true});
  await second.getByLabel('Bono en la segunda compra',{exact:true}).fill('12');await expect(second.getByRole('heading',{name:'Revisa el compromiso antes de activar'})).not.toBeVisible();
  await second.getByRole('button',{name:'Revisar antes de activar'}).click();await second.getByRole('button',{name:'Activar segunda visita en demostración'}).click();await expect(second.getByRole('switch')).toBeChecked();
  await expect(brief.getByRole('switch')).toBeDisabled();await expect(brief.getByRole('switch')).not.toBeChecked();
  await brief.getByRole('button',{name:'Preparar muestra, sin enviar'}).click();await expect(brief.getByRole('heading',{name:'Muestra del resumen · sin envío'})).toBeVisible();await expect(brief.getByText(/Todavía no hay envíos/)).toBeVisible();
  await brief.getByRole('button',{name:'Enviar código a mi correo'}).click();await brief.getByLabel('Código del correo',{exact:true}).fill('a'.repeat(43));await brief.getByRole('button',{name:'Verificar mi correo'}).click();await expect(brief.getByText('Correo verificado',{exact:true})).toBeVisible();await expect(brief.getByRole('switch')).not.toBeChecked();
  await brief.getByRole('button',{name:'Simular prueba de correo'}).click();await expect(brief.getByRole('status')).toContainText('La prueba no activa');
  await brief.getByRole('button',{name:'Actualizar estados del resumen'}).click();await expect(brief.getByText('Prueba solicitada · correo',{exact:true})).toBeVisible();await expect(brief.getByRole('switch')).not.toBeChecked();
  await brief.getByRole('switch').check();await brief.getByRole('button',{name:'Guardar resumen en demostración'}).click();await expect(brief.getByRole('switch')).toBeChecked();
  await page.addScriptTag({url:`${origin}/test-axe.js`});
  for(const mode of ['light','dark']){
   if(mode==='dark')await page.getByRole('button',{name:'Tema oscuro',exact:true}).click();
   const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations);await fs.writeFile(path.join(artifacts,`axe-${width}-${mode}.json`),JSON.stringify(violations,null,2));assert.deepEqual(violations,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(artifacts,`brief-${width}-${mode}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await context.close();
 }
 const bindingContext=await browser.newContext({viewport:{width:390,height:950},serviceWorkers:'block'}),bindingPage=await bindingContext.newPage();
 let bindingCurrent=false,testRequests=0,saves=0;
 await bindingPage.route('**/api/admin/automations/owner-brief**',async route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if(pathname.endsWith('/test')){testRequests++;await route.fulfill({json:{ok:true,id:'test-request',status:'queued'}});return;}
  if(request.method()==='PUT'){saves++;assert.deepEqual(request.postDataJSON(),{enabled:true,weekday:1,hour:9,channel:'email'});bindingCurrent=true;await route.fulfill({json:{ok:true}});return;}
  await route.fulfill({json:{settings:{enabled:true,weekday:1,hour:9,channel:'email'},channel:'email',email_destination:'new-owner@example.invalid',email_verified:true,destination_ready:true,provider_ready:true,email_provider_ready:true,recipient_is_current_owner:true,subscription_binding_current:bindingCurrent,timezone:'America/Guatemala',history:[]}});
 });
 await bindingPage.goto(`${origin}/negocio/tests/fixtures/owner-brief.html`);
 await expect(bindingPage.getByText('Actualiza el destinatario semanal',{exact:true})).toBeVisible();
 await expect(bindingPage.getByRole('button',{name:'Guardar resumen semanal',exact:true})).toBeEnabled();
 await bindingPage.getByRole('button',{name:'Enviar prueba a mi correo',exact:true}).click();await expect(bindingPage.getByRole('status')).toContainText('La prueba no activa');
 assert.equal(testRequests,1);assert.equal(saves,0);await expect(bindingPage.getByText('Actualiza el destinatario semanal',{exact:true})).toBeVisible();
 await bindingPage.getByRole('button',{name:'Guardar resumen semanal',exact:true}).click();await expect(bindingPage.getByText('Actualiza el destinatario semanal',{exact:true})).not.toBeVisible();
 await expect(bindingPage.getByRole('button',{name:'Guardar resumen semanal',exact:true})).toBeDisabled();assert.equal(saves,1);await bindingContext.close();
 console.log('Owner activation browser: desktop/mobile, second-visit review invalidation and explicit activation, email verification, no-send preview, explicit test, weekly opt-in, light/dark axe, zero API requests.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
