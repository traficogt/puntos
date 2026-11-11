import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import { demoAcquisition } from '../src/demo-acquisition.js';
const merchant=path.resolve(import.meta.dirname,'..'), project=path.resolve(merchant,'../..'), artifacts='/tmp/puntos-acquisition-browser', outDir=path.join(artifacts,'build');
await fs.mkdir(artifacts,{recursive:true});
await build({root:merchant,configFile:path.join(merchant,'vite.config.js'),build:{outDir,emptyOutDir:true,rollupOptions:{input:path.join(import.meta.dirname,'fixtures/acquisition.html')}},logLevel:'warn'});
const app=express();app.use(helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:null}}}));
app.get('/test-axe.js',(_q,res)=>res.sendFile(path.join(merchant,'node_modules/axe-core/axe.min.js')));
app.get('/negocio/acquisition-test',(_q,res)=>res.sendFile(path.join(outDir,'tests/fixtures/acquisition.html')));
app.use('/negocio',express.static(outDir));app.use(express.static(path.join(project,'public')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
async function fixture(params={},width=390){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),state={requests:[],errors:[],failure:false};
  await context.addCookies([{name:'pf_csrf_readable',value:'acquisition-browser',url:origin}]);
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());state.requests.push({path:url.pathname,method:req.method(),body:req.postDataJSON()});
    if(state.failure)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Unavailable'})});
    if(req.method()==='POST')assert.equal(req.headers()['x-csrf-token'],'acquisition-browser');
    const body=demoAcquisition(url,{method:req.method(),body:req.postData()});
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  page.on('pageerror',e=>state.errors.push(e.message));page.setDefaultTimeout(8000);
  await page.goto(`${origin}/negocio/acquisition-test?${new URLSearchParams(params)}`);return {page,context,state};
}
try{
  for(const params of [{locked:'1'},{manager:'1'}]){
    const h=await fixture(params);await expect(h.page.getByRole('heading',{name:'Orígenes de clientes',exact:true})).toBeVisible();assert.deepEqual(h.state.requests,[]);await h.context.close();
  }
  const real=await fixture({},1440);
  await expect(real.page.getByText('Mostrador · ejemplo',{exact:true})).toBeVisible();
  await real.page.getByLabel('Nombre del origen').fill('Entrada principal');
  await real.page.getByRole('button',{name:'Crear enlace',exact:true}).click();
  await expect(real.page.getByText('Entrada principal',{exact:true})).toBeVisible();
  const post=real.state.requests.find(r=>r.method==='POST');assert.deepEqual(Object.keys(post.body).sort(),['branch_id','name','request_id']);assert.equal(post.body.name,'Entrada principal');
  await real.page.getByRole('button',{name:'Cómo se cuentan estos resultados'}).click();
  await expect(real.page.getByText(/Las altas históricas se conservan sin datos personales/)).toBeVisible();
  assert.deepEqual(real.state.errors,[]);await real.context.close();
  for(const dark of [false,true]){
    const demo=await fixture({demo:'1',...(dark?{dark:'1'}:{})});
    await expect(demo.page.getByRole('heading',{name:'De un enlace a una nueva visita'})).toBeVisible();
    await expect(demo.page.getByText('Mostrador · ejemplo',{exact:true})).toBeVisible();
    await demo.page.getByLabel('Nombre del origen').fill('Cartel de prueba');
    await demo.page.getByRole('button',{name:'Crear enlace',exact:true}).click();
    await expect(demo.page.getByText('Cartel de prueba',{exact:true})).toBeVisible();
    assert.deepEqual(demo.state.requests,[]);assert.deepEqual(demo.state.errors,[]);
    await demo.page.addScriptTag({url:`${origin}/test-axe.js`});
    const violations=await demo.page.evaluate(async()=>(await window.axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations);
    await fs.writeFile(path.join(artifacts,`axe-${dark?'dark':'light'}.json`),JSON.stringify(violations,null,2));assert.deepEqual(violations,[]);
    assert.equal(await demo.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await demo.page.screenshot({path:path.join(artifacts,`mobile-${dark?'dark':'light'}.png`),fullPage:true});await demo.context.close();
  }
  console.log('Acquisition browser: owner/plan gates, scoped create payload, metric definitions, mobile light/dark accessibility, demo zero real API requests.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
