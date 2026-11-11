import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {chromium} from 'playwright';
import {startPwaStaticServer} from '../../../tests/integration/helpers/pwa-static-server.js';
assert.equal(await access('public/staff/pos-recording.js').then(()=>true,()=>false),true,'Staff receipt module must exist');
const server=await startPwaStaticServer(),browser=await chromium.launch();
try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],network=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))network.push(r.url());});
 await page.route('**/pos-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrega en caja</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/operations-modern.css"><link rel="stylesheet" href="/staff/service-cases.css"></head><body class="operations-shell app-shell page-staff"><main style="max-width:760px;margin:auto;padding:16px"><h1>Atención al cliente</h1><p id="balance">Saldo: 50 puntos</p><section id="receipt" class="staff-service-cases"></section></main></body></html>'}));
 await page.goto(`${server.baseUrl}/pos-fixture`);
 await page.evaluate(async()=>{
  const {mountPosRecording}=await import('/staff/pos-recording.js');
  window.ctx={customerId:'customer-a',staffId:'cashier-a',businessId:'business-a',branchId:'branch-a',online:true};window.writes=[];window.failRead=false;window.delayRead=false;window.loseAck=true;window.record={status:'pending',version:0,stockStatus:'unknown',returnedQuantity:0};
  window.receipt=mountPosRecording({container:document.querySelector('#receipt'),getContext:()=>window.ctx,api:async(path,options={})=>{
   if(options.method==='POST'){const value=JSON.parse(options.body);window.writes.push(value);window.record={...window.record,status:value.action,version:1,method:'manual',receiptRef:value.receiptRef};if(window.loseAck){window.loseAck=false;throw Error('No se confirmó la respuesta. Reintenta.');}return {ok:true,fulfillment:window.record};}
   if(window.delayRead)await new Promise(resolve=>window.releaseRead=resolve);
   if(window.failRead)throw Object.assign(Error('Canje no encontrado en esta sucursal.'),{status:404});
   return {redemption:{id:path.split('/').pop(),code:'A1000001',customer_id:'customer-a',points_restored:false},fulfillment:window.unknown?null:window.record,events:[]};
  }});
  window.receipt.showRedemption({redemptionId:'redeem-a',redemptionCode:'A1000001',customerId:'customer-a'});
 });
 await page.getByText('Canje confirmado en PF. Código: A1000001',{exact:true}).waitFor();await page.getByLabel('Referencia del recibo de caja').fill('REC-STAFF-1');await page.getByLabel('Detalle de la comprobación').fill('Registrado al entregar el café.');assert.equal(await page.getByRole('button',{name:'Guardar comprobación en PF',exact:true}).isEnabled(),false);await page.getByLabel('Comprobé el recibo y lo descrito.').check();
 await page.addScriptTag({path:'web/merchant/node_modules/axe-core/axe.min.js'});await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [1200,390])for(const theme of ['light','dark']){await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const result=await page.evaluate(()=>window.axe.run({include:['#receipt']},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[]);await page.screenshot({path:`/tmp/pf-staff-pos-${width}-${theme}.png`,fullPage:true});}
 assert.equal(await page.getByRole('option',{name:'No corresponde'}).count(),0);
 await context.setOffline(true);await page.getByText(/Conéctate para comprobar el registro/).waitFor();assert.equal(await page.getByRole('button',{name:'Guardar comprobación en PF',exact:true}).isEnabled(),false);assert.equal(await page.evaluate(()=>window.writes.length),0);await context.setOffline(false);
 await page.getByRole('button',{name:'Guardar comprobación en PF',exact:true}).click();await page.getByText('No se confirmó la respuesta. Reintenta.',{exact:true}).waitFor();assert.equal(await page.locator('#balance').textContent(),'Saldo: 50 puntos');await page.getByRole('button',{name:'Guardar comprobación en PF',exact:true}).click();await page.getByText('Comprobación guardada en PF. Las existencias se verifican en tu caja.',{exact:true}).waitFor();const writes=await page.evaluate(()=>window.writes);assert.deepEqual(writes[0],writes[1]);assert.equal(Object.hasOwn(writes[0],'branchId'),false);
 await page.evaluate(()=>{window.failRead=true;window.receipt.showRedemption({redemptionId:'redeem-denied',redemptionCode:'A1000002',customerId:'customer-a'});});await page.getByText('Canje no encontrado en esta sucursal.',{exact:true}).waitFor();assert.equal(await page.locator('#receipt form').count(),0);await page.getByText('Canje confirmado en PF. Código: A1000002',{exact:true}).waitFor();
 await page.evaluate(()=>{window.failRead=false;window.unknown=true;window.receipt.showRedemption({redemptionId:'redeem-old',redemptionCode:'A1000003',customerId:'customer-a'});});await page.getByText(/Histórico sin evidencia/).waitFor();assert.equal(await page.getByLabel('Comprobación del canje').inputValue(),'review');assert.equal(await page.getByLabel('Referencia del recibo de caja').isVisible(),false);
 await page.evaluate(()=>{window.delayRead=true;window.receipt.showRedemption({redemptionId:'redeem-slow',redemptionCode:'A1000004',customerId:'customer-a'});});await page.getByText('Consultando el registro de caja…',{exact:true}).waitFor();await page.evaluate(()=>{window.ctx={...window.ctx,customerId:'customer-b'};window.receipt.contextChanged();window.releaseRead();});assert.equal(await page.locator('#receipt').isHidden(),true);assert.equal(await page.locator('#receipt').textContent(),'');
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 const scanner=await context.newPage();scanner.setDefaultTimeout(10000);scanner.on('pageerror',e=>errors.push(e.message));
 const calls=[];let slowRedeem=false,releaseRedeem=null;
 await scanner.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(url.origin!==server.baseUrl)return route.abort();
  if(!path.startsWith('/api/'))return route.continue();
  calls.push(path);let json;
  if(path==='/api/staff/me')json={staff:{id:'staff-a',business_id:'business-a',branch_id:'branch-a',role:'CASHIER'},features:{redemptions:true}};
  else if(path==='/api/staff/permissions')json={matrix:{CASHIER:['staff.award','staff.sync','staff.redeem']}};
  else if(path==='/api/staff/program')json={program_type:'VISIT',program_json:{points_per_visit:5}};
  else if(path==='/api/staff/offline-grant')json={grant:'synthetic',expiresAt:new Date(Date.now()+86400000).toISOString()};
  else if(path==='/api/staff/rewards')json={rewards:[{id:'reward-a',name:'Café de prueba',points_cost:50}]};
  else if(path==='/api/staff/customer/lookup')json={customer:{id:request.postDataJSON().customerQrToken==='other-token'?'customer-b':'customer-a',name:'Cliente de prueba',points:120}};
  else if(path==='/api/staff/shift-briefing')json={notices:[]};
  else if(path==='/api/staff/service-authority')json={grants:[],owner:false};
  else if(path==='/api/staff/reward-entitlements')json={points:120,cycle:null,promises:[{id:'promise-a',reward_id:'reward-a',reward_name:'Café protegido',points_cost:50,stock:5,available:true,alternatives:[]}],hospitality:[],server_now:new Date().toISOString()};
  else if(path==='/api/staff/hospitality')json={server_now:new Date().toISOString(),grants:[]};
  else if(path==='/api/staff/redeem'){if(slowRedeem)await new Promise(resolve=>releaseRedeem=resolve);json={newBalance:70,redemptionId:'normal-redemption',redemptionCode:'F1000001'};}
  else if(path==='/api/staff/reward-entitlements/redeem')json={newBalance:20,redemptionId:'protected-redemption',redemptionCode:'F1000002'};
  else if(path.startsWith('/api/staff/redemption-pos/'))json={redemption:{id:path.split('/').pop(),customer_id:'customer-a'},fulfillment:{status:'pending',version:0},events:[]};
  else json={ok:true};return route.fulfill({json});
 });
 await scanner.goto(`${server.baseUrl}/staff?sw=noreload`);await scanner.locator('#token').fill('first-token');await scanner.locator('#btnSelectCustomer').click();await scanner.getByRole('button',{name:'Confirmar entrega protegida',exact:true}).waitFor();await scanner.locator('#btnRedeem').click();await scanner.getByText('Canje confirmado en PF. Código: F1000001',{exact:true}).waitFor();assert.equal(await scanner.locator('#lastBalance').textContent(),'70');
 await scanner.getByRole('button',{name:'Confirmar entrega protegida',exact:true}).click();await scanner.getByText('Canje confirmado en PF. Código: F1000002',{exact:true}).waitFor();await scanner.getByLabel('Referencia del recibo de caja').waitFor();
 assert.ok(calls.includes('/api/staff/redemption-pos/normal-redemption'));assert.ok(calls.includes('/api/staff/redemption-pos/protected-redemption'));
 await scanner.locator('#token').fill('first-token');await scanner.locator('#btnSelectCustomer').click();slowRedeem=true;await scanner.locator('#btnRedeem').click();await scanner.waitForFunction(()=>document.querySelector('#customerActionStatus')?.textContent?.includes('Canjeando'));
 await scanner.locator('#token').fill('other-token');await scanner.locator('#btnSelectCustomer').click();await scanner.waitForFunction(()=>document.querySelector('#lastCustomer')?.textContent==='customer-b');assert.equal(typeof releaseRedeem,'function');releaseRedeem();await scanner.waitForFunction(()=>document.querySelector('#lastBalance')?.textContent==='120');assert.equal(await scanner.locator('#staffPosRecording').isHidden(),true);assert.deepEqual(errors,[]);
 console.log('Staff POS recording: 4 viewport/theme axe checks; stable retry, offline, branch denial, history/stale context; standard and protected scanner wiring; only synthetic APIs.');
}finally{await browser.close();await server.stop();}
