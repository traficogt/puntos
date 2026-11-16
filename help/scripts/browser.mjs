import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import helmet from 'helmet';
import {chromium, expect} from '@playwright/test';
const root=fileURLToPath(new URL('../../',import.meta.url));
const artifacts=process.env.PF_HELP_ARTIFACTS || await fs.mkdtemp(path.join(os.tmpdir(),'pf-help-browser-'));
await fs.mkdir(artifacts,{recursive:true});
const app=express();app.use(helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:null,scriptSrc:["'self'"],styleSrc:["'self'"],workerSrc:["'self'"]}}}));app.use(express.static(path.join(root,'public')));
const axe=await fs.readFile(path.join(root,'web/merchant/node_modules/axe-core/axe.min.js'),'utf8');
app.get('/__help-axe.js',(_req,res)=>res.type('js').send(axe));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
const errors=[],csp=[],failedRequests=[];let checks=0;
const pass=label=>{checks++;console.log('PASS '+label);};
async function session(width=1440,options={}){
 const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',...options});
 await context.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>window.__helpCsp.push(event.violatedDirective)));
 await context.addInitScript(()=>{window.__helpCsp=[];});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){failedRequests.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 return {context,page};
}
async function inspect(page,name){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow: '+name);
 await page.addScriptTag({url:origin+'/__help-axe.js'});
 const violations=await page.evaluate(async()=> (await axe.run()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})));
 assert.deepEqual(violations,[],`Accessibility: ${name}`);
 csp.push(...await page.evaluate(()=>window.__helpCsp));
 pass('accessible '+name);
}
try{
 for(const width of [1440,390,320]){
  const {context,page}=await session(width);
  await page.goto(origin+'/ayuda/');await expect(page.locator('h1')).toHaveText('¿Qué necesitas hacer?');
  await expect(page.getByRole('link',{name:'Ver las guías del equipo',exact:true})).toBeVisible();
  await inspect(page,`home ${width}px`);
  if(width!==320)await page.screenshot({path:path.join(artifacts,`home-${width}.png`),fullPage:true});
  await page.getByLabel('Busca una tarea o un problema').fill('QR');
  await expect(page.locator('#search-results a').first()).toBeVisible();
  await expect(page.locator('#search-status')).toContainText('guías encontradas');
  assert((await page.locator('#search-results').innerText()).toLowerCase().includes('qr'));
  pass('two-letter Spanish search QR at '+width);
  await page.getByLabel('Busca una tarea o un problema').fill('contraseña');
  await expect(page.locator('#search-results')).toContainText('contraseña');
  await page.getByLabel('Busca una tarea o un problema').fill('"<script>:*');
  await expect(page.locator('#search-status')).toContainText('No encontramos');
  await page.getByRole('button',{name:'Cerrar resultados',exact:true}).click();
  await expect(page.locator('#search-results')).toBeHidden();
  if(width<900){const menu=page.locator('.guide-menu');await menu.locator(':scope > summary').focus();await page.keyboard.press('Enter');await expect(menu).toHaveAttribute('open','');await page.keyboard.press('Enter');await expect(menu).not.toHaveAttribute('open','');pass('keyboard mobile navigation '+width);}
  await page.goto(origin+'/ayuda/caja/sin-conexion/');
  await expect(page.getByRole('heading',{name:'Qué puedes hacer sin internet',exact:true})).toBeVisible();
  await inspect(page,`article ${width}px`);
  if(width!==320)await page.screenshot({path:path.join(artifacts,`article-${width}.png`),fullPage:true});
  await context.close();
 }
 const {context,page}=await session(1100);
 await page.goto(origin+'/ayuda/?q=QR');await expect(page.locator('#search-results a').first()).toBeVisible();pass('shareable search URL');
 await page.goto(origin+'/ayuda/negocio/clientes/');await inspect(page,'owner guide');
 await page.goto(origin+'/ayuda/caja/practicar/');await expect(page.locator('figure img')).toBeVisible();assert(await page.locator('figure img').evaluate(image=>image.complete&&image.naturalWidth>0));pass('demo screenshot loads');
 await page.goto(origin+'/ayuda/caja/lista-del-turno/');await page.emulateMedia({media:'print'});await expect(page.locator('.sidebar')).toBeHidden();await expect(page.locator('.checklist').first()).toBeVisible();await page.pdf({path:path.join(artifacts,'lista-del-turno.pdf'),format:'A4',printBackground:true});pass('print checklist');
 await context.close();
 const nojs=await session(390,{javaScriptEnabled:false});await nojs.page.goto(origin+'/ayuda/');await expect(nojs.page.locator('h1')).toBeVisible();await expect(nojs.page.getByRole('link',{name:'Ver las guías del equipo',exact:true})).toBeVisible();await nojs.context.close();pass('content and navigation without JavaScript');
 const fallback=await session();await fallback.context.addInitScript(()=>Object.defineProperty(window,'Worker',{value:undefined}));await fallback.page.goto(origin+'/ayuda/?q=QR');await expect(fallback.page.locator('#search-results a').first()).toBeVisible();await fallback.context.close();pass('search fallback without Worker');
 assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);assert.deepEqual(failedRequests,[]);pass('no browser errors, CSP violations or external requests');
 await fs.writeFile(path.join(artifacts,'results.json'),JSON.stringify({checks,artifacts,errors,csp,failedRequests},null,2)+'\n');console.log(`PASS ${checks} checks; artifacts: ${artifacts}`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
