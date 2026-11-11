import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import {chromium,expect} from '@playwright/test';
import {build} from 'vite';
const merchant=path.resolve(import.meta.dirname,'..'),project=path.resolve(merchant,'../..'),artifacts='/var/lib/puntos/releases/merchant-growth-controls-20261110/browser',outDir=path.join(artifacts,'build');
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
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[];
    page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.push(request.url());});
    for(const [hash,heading] of [['origenes','De un enlace a una nueva visita'],['costos','El costo de tus recompensas'],['conectar-caja','Conectar caja'],['automatizaciones','Un buen motivo para volver']]) {
      await page.goto(`${origin}/demostracion/#${hash}`);await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible({timeout:15000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,hash);
    }
    await fs.writeFile(path.join(artifacts,`automation-dom-${width}.txt`),await page.locator('body').ariaSnapshot());
    await page.getByRole('switch',{name:/Activar cumpleaños/}).check();
    await page.getByLabel('Presupuesto mensual de cumpleaños',{exact:true}).fill('10');
    await page.getByRole('button',{name:'Guardar en demostración',exact:true}).click();
    await expect(page.getByText('El presupuesto debe cubrir al menos un incentivo.')).toBeVisible();
    await page.getByLabel('Presupuesto mensual de cumpleaños',{exact:true}).fill('1200');
    await page.getByRole('button',{name:'Guardar en demostración',exact:true}).click();
    await expect(page.getByText('Activa',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Guardar en demostración',exact:true})).toBeDisabled();
    await page.addScriptTag({url:`${origin}/test-axe.js`});
    const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations);
    await fs.writeFile(path.join(artifacts,`axe-${width}.json`),JSON.stringify(violations,null,2));assert.deepEqual(violations,[]);
    await page.screenshot({path:path.join(artifacts,`automations-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Tema oscuro',exact:true}).click();
    const darkViolations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations);assert.deepEqual(darkViolations,[]);
    await page.screenshot({path:path.join(artifacts,`automations-${width}-dark.png`),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await context.close();
  }
  console.log('Integrated merchant browser: four sections, mobile overflow, automation validation and save, accessibility, demo zero API requests.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
