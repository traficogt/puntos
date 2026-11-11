import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import {chromium,expect} from '@playwright/test';
import {build} from 'vite';
const merchant=path.resolve(import.meta.dirname,'..'),project=path.resolve(merchant,'../..'),artifacts='/tmp/pf-wallet-locations-browser',outDir=path.join(artifacts,'build');
await fs.mkdir(artifacts,{recursive:true});
await build({root:merchant,configFile:path.join(merchant,'vite.config.js'),build:{outDir,emptyOutDir:true,rollupOptions:{input:path.join(import.meta.dirname,'fixtures/wallet-locations.html')}},logLevel:'warn'});
const app=express();app.use(helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:null}}}));
app.get('/test-axe.js',(_q,res)=>res.sendFile(path.join(merchant,'node_modules/axe-core/axe.min.js')));
app.get('/negocio/wallet-test',(_q,res)=>res.sendFile(path.join(outDir,'tests/fixtures/wallet-locations.html')));
app.use('/negocio',express.static(outDir));app.use(express.static(path.join(project,'public')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
try{
 for(const width of [1440,390])for(const dark of [false,true]){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[],writes=[];
  let fail=false;const branch={id:'22222222-2222-4222-8222-222222222222',name:'Centro',address:'Dirección pública',wallet_location_enabled:false,wallet_latitude:null,wallet_longitude:null};
  page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'pf_csrf_readable',value:'wallet-browser',url:origin}]);
  await context.route('**/api/**',async route=>{const req=route.request();assert.ok(new URL(req.url()).pathname.startsWith('/api/admin/branches/'));
   if(req.method()==='PUT'){assert.equal(req.headers()['x-csrf-token'],'wallet-browser');if(fail)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Desactiva otra ubicación antes de continuar.'})});const body=req.postDataJSON();writes.push(body);Object.assign(branch,{wallet_location_enabled:body.enabled,wallet_latitude:body.latitude,wallet_longitude:body.longitude});}
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,branches:[branch],branch,maximum_locations:10})});});
  await page.goto(`${origin}/negocio/wallet-test${dark?'?dark=1':''}`);await expect(page.getByLabel('Latitud',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Guardar ubicación',exact:true})).toBeDisabled();
  await page.getByLabel('Latitud',{exact:true}).fill('91');await page.getByLabel('Longitud',{exact:true}).fill('-90.5');await page.getByRole('button',{name:'Guardar ubicación',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Ingresa ambas coordenadas válidas');assert.equal(writes.length,0);
  await page.getByLabel('Latitud',{exact:true}).fill('14.6');await page.getByRole('checkbox',{name:'Usar esta ubicación en las tarjetas de Wallet'}).check();
  fail=true;await page.getByRole('button',{name:'Guardar ubicación',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Desactiva otra ubicación');
  fail=false;await page.getByRole('button',{name:'Guardar ubicación',exact:true}).click();await expect(page.getByRole('status')).toContainText('Ubicación guardada');assert.deepEqual(writes[0],{enabled:true,latitude:14.6,longitude:-90.5});await expect(page.getByRole('button',{name:'Guardar ubicación',exact:true})).toBeDisabled();
  await page.addScriptTag({url:`${origin}/test-axe.js`});const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations);assert.deepEqual(violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(artifacts,`${width}-${dark?'dark':'light'}.png`),fullPage:true});
  await page.getByRole('checkbox',{name:'Usar esta ubicación en las tarjetas de Wallet'}).uncheck();await page.getByLabel('Latitud',{exact:true}).fill('');await page.getByLabel('Longitud',{exact:true}).fill('');await page.getByRole('button',{name:'Guardar ubicación',exact:true}).click();await expect(page.getByRole('status')).toContainText('Ubicación guardada');assert.deepEqual(writes.at(-1),{enabled:false,latitude:null,longitude:null});
  await context.close();
 }
 console.log('Wallet locations: desktop/mobile, light/dark, validation, CSRF payload, failure recovery, save/removal, zero axe violations and no overflow.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
