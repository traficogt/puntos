import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import {chromium,expect} from '@playwright/test';
import {build} from 'vite';
const merchant=path.resolve(import.meta.dirname,'..'),project=path.resolve(merchant,'../..'),artifacts='/var/lib/puntos/releases/merchant-evidence-20261111/measurement-browser',outDir=path.join(artifacts,'build');
await fs.mkdir(artifacts,{recursive:true});
await build({root:merchant,configFile:path.join(merchant,'vite.config.js'),build:{outDir,emptyOutDir:true},logLevel:'warn'});
const app=express();app.use(helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:null}}}));
app.get('/demostracion/',(_q,res)=>res.sendFile(path.join(outDir,'index.html')));
app.get('/runtime-config.js',(_q,res)=>res.type('js').send('window.__PF_RUNTIME_CONFIG__={};'));
app.get('/test-axe.js',(_q,res)=>res.sendFile(path.join(merchant,'node_modules/axe-core/axe.min.js')));
app.use('/negocio',express.static(outDir));app.use(express.static(path.join(project,'public')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
try {
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url());});
  page.setDefaultTimeout(7000);await page.goto(`${origin}/demostracion/#ofertas`);
  await page.getByRole('button',{name:'Vuelve por tu café · ejemplo',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Qué sabemos de esta campaña',exact:true})).toBeVisible();
  await expect(page.getByText('La prueba sigue en curso',{exact:true})).toBeVisible();
  await expect(page.getByText(/Intervalo de confianza del 95%/).first()).toBeVisible();
  await expect(page.getByText(/Diferencia descriptiva de ventas/)).toBeVisible();
  await expect(page.getByText(/Ventas adicionales estimadas/)).toHaveCount(0);
  await expect(page.getByText(/no prueban entrega ni lectura/)).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.addScriptTag({url:`${origin}/test-axe.js`});
  for(const theme of ['light','dark']){
   if(theme==='dark')await page.getByRole('button',{name:'Tema oscuro',exact:true}).click();
   const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations);
   await fs.writeFile(path.join(artifacts,`axe-${width}-${theme}.json`),JSON.stringify(violations,null,2));assert.deepEqual(violations,[]);
   await page.locator('#growth-results').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`results-${width}-${theme}.png`),fullPage:true});
  }
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Pausar campaña',exact:true}).click();
  await expect(page.getByText('La prueba se interrumpió',{exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await context.close();
 }
 console.log('Campaign measurement: real demo, fixed assigned denominators, uncertainty, paused state, mobile/light/dark, axe, no API requests.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
