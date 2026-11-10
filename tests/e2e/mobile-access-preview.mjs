/* eslint-disable security/detect-non-literal-fs-filename -- This runner controls its temporary directory, exported bundle, and evidence paths. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import express from 'express';import {chromium} from 'playwright';import {createMobilePreview} from '../../src/middleware/mobile-preview.js';
const appDirectory=path.resolve(process.env.PF_CUSTOMER_APP_DIR||fileURLToPath(new URL('../../apps/customer/',import.meta.url)));
const evidence=process.env.PF_PREVIEW_EVIDENCE_DIR||path.join(appDirectory,'artifacts','access');await mkdir(evidence,{recursive:true});
const directory=await mkdtemp(path.join(tmpdir(),'pf-app-browser-'));await symlink(path.join(appDirectory,'dist'),path.join(directory,'app-preview'));
const server=express().use('/app-preview',createMobilePreview(directory)).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');const local=`http://127.0.0.1:${address.port}`;
// Route all browser requests to deterministic fixtures; never contact a live account.
const origin='https://app.puntosfieles.com';const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const results=[];
// NetInfo checks HEAD / on web. Abort every other unrecognized destination.
async function context(options={}){const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',...options});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin===origin&&u.pathname.startsWith('/app-preview/')){const response=await route.fetch({url:local+u.pathname+u.search});return route.fulfill({response});}if(u.origin===origin&&u.pathname==='/'&&route.request().method()==='HEAD')return route.fulfill({status:200,body:''});if(u.origin===origin&&u.pathname.startsWith('/api/mobile/'))return route.fulfill({status:503,json:{error:'Fixture disabled'}});return route.abort();});return {context,page,errors};}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
const business={id:'11111111-1111-4111-8111-111111111111',name:'Café de prueba',slug:'test-cafe',features:{rewards:true}};
const second={id:'22222222-2222-4222-8222-222222222222',name:'Restaurante con un nombre largo para comprobar la tarjeta',slug:'restaurante'};
const customer={id:'33333333-3333-4333-8333-333333333333',name:'Ana',phone:'50255555555',points:500};
const session={status:'signed_in',token:'fixture-session',expiresAt:'2099-01-01T00:00:00Z',business,customer};
const choice=(ttl=300000)=>({status:'choose_card',accessToken:'a'.repeat(43),expiresAt:new Date(Date.now()+ttl).toISOString(),cards:[business,second]});
async function login(page){await page.getByRole('heading',{name:'Iniciar sesión',exact:true}).waitFor();assert.equal(await page.getByLabel('Enlace o código del negocio',{exact:true}).count(),0);await page.getByLabel('Teléfono',{exact:true}).fill('+50255555555');await page.getByRole('button',{name:'Enviarme un código'}).click();await page.getByLabel('Código de 6 dígitos',{exact:true}).fill('123456');}
try {
 for(const scenario of ['single','multiple','no-cards','expired-choice','rejected-choice','cancel-verify','cooldown','join','snapshot-unavailable']){
  const {context:c,page,errors}=await context({viewport:{width:320,height:900}});let codeRequests=0,selected=null,releaseVerify;
  await c.route('**/api/mobile/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname,body=req.postDataJSON();
   if(p.endsWith('/business/test-cafe'))return route.fulfill({json:business});
   if(p.endsWith('/request-code')){codeRequests++;assert.equal(req.headers().authorization,undefined);return route.fulfill({json:{ok:true}});}
   if(p.endsWith('/verify')){
    if(scenario==='cancel-verify')await new Promise(resolve=>{releaseVerify=resolve;});
    if(scenario==='multiple'||scenario==='rejected-choice')return route.fulfill({json:choice()});
    if(scenario==='expired-choice')return route.fulfill({json:choice(500)});
    if(scenario==='no-cards')return route.fulfill({json:{status:'no_cards'}});
    return route.fulfill({json:session});
   }
   if(p.endsWith('/access/select')){assert.equal(req.headers().authorization,undefined);assert.equal(req.headers().cookie,undefined);assert.equal(body.accessToken,'a'.repeat(43));selected=body.businessId;return route.fulfill(scenario==='rejected-choice'?{status:401,json:{}}:{json:session});}
   if(p.endsWith('/customer')){if(scenario==='snapshot-unavailable')return route.fulfill({status:503,json:{}});assert.equal(req.headers().authorization,'Bearer fixture-session');return route.fulfill({json:{business,customer,rewards:[],transactions:[],redemptions:[],wallet:{providers:{apple:false,google:false},passes:[]}}});}
   throw Error('Unexpected route '+p);
  });
  await page.goto(origin+'/app-preview/'+(scenario==='join'?'?business=test-cafe':''));
  if(scenario==='join'){
   await page.getByRole('heading',{name:'Crea tu tarjeta',exact:true}).waitFor();await page.getByLabel('Tu nombre',{exact:true}).fill('Ana');await page.getByLabel('Teléfono',{exact:true}).fill('+50255555555');await page.getByRole('button',{name:'Enviarme un código'}).click();await page.getByLabel('Código de 6 dígitos',{exact:true}).fill('123456');
  }else await login(page);
  if(scenario==='cooldown'){
   await page.getByRole('button',{name:'Volver',exact:true}).click();await page.getByRole('button',{name:'Continuar con mi código',exact:true}).click();await page.getByRole('heading',{name:'Confirma tu teléfono',exact:true}).waitFor();assert.equal(codeRequests,1);
  }else{
   await page.getByRole('button',{name:'Abrir mi tarjeta',exact:true}).click();
   if(scenario==='multiple'){
    await page.getByRole('heading',{name:'Tus tarjetas',exact:true}).waitFor();await noOverflow(page);await page.screenshot({path:path.join(evidence,'choose-card-320.png')});await page.getByRole('button',{name:second.name,exact:true}).click();await page.getByText('500',{exact:true}).waitFor();assert.equal(selected,second.id);
   }else if(scenario==='no-cards'){
    await page.getByRole('heading',{name:'Aún no tienes tarjetas',exact:true}).waitFor();await page.getByRole('button',{name:'Crear una tarjeta',exact:true}).click();await page.getByLabel('Enlace o código del negocio',{exact:true}).waitFor();
   }else if(scenario==='expired-choice'||scenario==='rejected-choice'){
    if(scenario==='rejected-choice')await page.getByRole('button',{name:business.name,exact:true}).click();
    await page.getByRole('button',{name:'Volver a verificar mi teléfono',exact:true}).click();await page.getByRole('heading',{name:'Iniciar sesión',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:business.name,exact:true}).count(),0);
   }else if(scenario==='cancel-verify'){
    await page.waitForTimeout(100);assert.equal(typeof releaseVerify,'function');await page.getByRole('button',{name:'Volver',exact:true}).click();releaseVerify();await page.waitForTimeout(200);await page.getByRole('heading',{name:'Iniciar sesión',exact:true}).waitFor();assert.equal(await page.getByText('500',{exact:true}).count(),0);
   }else if(scenario==='snapshot-unavailable'){await page.getByRole('tab',{name:'Premios',exact:true}).click();await page.getByRole('button',{name:'Volver a cargar',exact:true}).waitFor();assert.equal(await page.getByText('Aún no hay recompensas',{exact:true}).count(),0);await page.getByRole('tab',{name:/Actividad$/}).click();await page.getByRole('button',{name:'Volver a cargar',exact:true}).waitFor();}else await page.getByText('500',{exact:true}).waitFor();
  }
  await noOverflow(page);assert.deepEqual(errors,[]);results.push({case:scenario,passed:true});await c.unrouteAll({behavior:'wait'});await c.close();
 }
 await writeFile(path.join(evidence,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,results,evidence}));
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
