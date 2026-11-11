import {readinessForBusiness} from '../../src/app/services/merchant-data-readiness.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,beforeEach,after,it} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import {createGrowthMessagingRoutes} from '../../src/app/routes/growth-messaging-routes.js';
import {config} from '../../src/config/index.js';
import {StaffRepo} from '../../src/app/repositories/staff-repository.js';
import {BusinessRepo} from '../../src/app/repositories/business-repository.js';
import {SecurityEventRepo} from '../../src/app/repositories/security-event-repository.js';
import {PlanConfigService} from '../../src/app/services/plan-config-service.js';
import {createBrowserSession} from '../../src/app/services/auth-session-service.js';
import {errorHandler} from '../../src/middleware/common.js';
const businessId=randomUUID(),customerId=randomUUID(),staffId=randomUUID(),campaignId=randomUUID();
const csrf='fixture-growth-csrf';
let origin,server,staffCookie,customerCookie,role,plan,calls,featureOverrides;
const originals={staff:StaffRepo.getById,business:BusinessRepo.getById,security:SecurityEventRepo.log,plans:PlanConfigService.getPlanFeatureOverrides};
before(async()=>{
  StaffRepo.getById=async()=>({id:staffId,business_id:businessId,active:true,role});
  BusinessRepo.getById=async()=>({id:businessId,plan});SecurityEventRepo.log=async()=>{};PlanConfigService.getPlanFeatureOverrides=async()=>featureOverrides;
  const staff=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'});
  const customer=await createBrowserSession({actorType:'CUSTOMER',actorId:customerId,businessId});
  staffCookie=`${config.STAFF_COOKIE_NAME}=${staff.token}; pf_csrf=${csrf}`;
  customerCookie=`${config.CUSTOMER_COOKIE_NAME}=${customer.token}; pf_csrf=${csrf}`;
  const handler=kind=>async input=>{calls.push({kind,input});return {ok:true,data_readiness:readinessForBusiness({}),pause_reason:null,pause_until:null,business_name:'Café',marketing_opt_in:false,preview:{body:'fixture',delivery_note:'fixture'},eligible_count:0,counts:{},total:0,can_queue:false,provider_ready:false,provider_note:"fixture",queued_count:0,replayed:false};};
  const app=express();app.use(express.json(),cookieParser());
  app.use('/api',createGrowthMessagingRoutes({getPreference:handler('get'),setPreference:handler('set'),tokenPreference:handler('token'),getMessages:handler('messages'),queueMessages:handler('queue')}));
  app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
beforeEach(()=>{calls=[];role='OWNER';plan='NEGOCIO';featureOverrides={};});
after(async()=>{await new Promise(resolve=>server?.close(resolve));StaffRepo.getById=originals.staff;BusinessRepo.getById=originals.business;SecurityEventRepo.log=originals.security;PlanConfigService.getPlanFeatureOverrides=originals.plans;});
async function request(path,{method='GET',body=undefined,cookie='',token=csrf,requestOrigin=origin}={}) {
  const response=await fetch(`${origin}/api${path}`,{method,headers:{'Content-Type':'application/json',cookie,'x-csrf-token':token,origin:requestOrigin},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
}
const preferences='/customer/marketing-preferences';const messages=`/admin/growth-campaigns/${campaignId}/messages`;
it('customer preference requires the customer session, and never lets staff opt in a customer',async()=>{
  for(const cookie of ['',staffCookie]) assert.equal((await request(preferences,{cookie})).status,401);
  assert.equal(calls.length,0);
  const response=await request(preferences,{cookie:customerCookie});assert.equal(response.status,200);assert.equal(response.cache,'no-store');
  assert.deepEqual(calls[0],{kind:'get',input:{businessId,customerId}});
});
it('customer mutation requires CSRF, strict boolean, own tenant, and rejects supplied customer identity',async()=>{
  for(const extra of [{token:''},{token:'wrong'},{requestOrigin:'https://other.invalid'}]) assert.equal((await request(preferences,{method:'PUT',cookie:customerCookie,body:{marketing_opt_in:true},...extra})).status,403);
  for(const body of [{marketing_opt_in:'true'},{marketing_opt_in:true,customer_id:randomUUID()},{marketing_opt_in:true,business_id:randomUUID()}]) assert.equal((await request(preferences,{method:'PUT',cookie:customerCookie,body})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await request(preferences,{method:'PUT',cookie:customerCookie,body:{marketing_opt_in:true}})).status,200);
  assert.deepEqual(calls[0].input,{businessId,customerId,marketing_opt_in:true});
});
it('public token GET does not confirm and POST demands explicit confirmation, CSRF and origin',async()=>{
  const path=`/public/marketing-unsubscribe/${'a'.repeat(43)}`;
  assert.equal((await request(path)).status,200);assert.equal(calls[0].input.confirm,undefined);calls=[];
  for(const extra of [{cookie:''},{token:''},{requestOrigin:'https://other.invalid'},{body:{confirm:false}},{body:{confirm:true,marketing_opt_in:true}}]) assert.ok([400,403].includes((await request(path,{method:'POST',cookie:`pf_csrf=${csrf}`,body:{confirm:true},...extra})).status));
  assert.equal(calls.length,0);
  assert.equal((await request(path,{method:'POST',cookie:`pf_csrf=${csrf}`,body:{confirm:true}})).status,200);
  assert.equal(calls[0].input.confirm,true);
});
it('campaign messages require owner, both plan features, and tenant bound service arguments',async()=>{
  assert.equal((await request(messages)).status,401);
  assert.equal((await request(messages,{cookie:customerCookie})).status,401);
  role='CASHIER';assert.equal((await request(messages,{cookie:staffCookie})).status,403);
  role='OWNER';plan='EMPRENDEDOR';assert.equal((await request(messages,{cookie:staffCookie})).status,403);
  plan='NEGOCIO';assert.equal(calls.length,0);
  assert.equal((await request(messages,{cookie:staffCookie})).status,200);
  assert.deepEqual(calls[0].input,{businessId,campaignId});
});
it('analytics overrides lock both campaign message routes before service access',async()=>{
  featureOverrides={NEGOCIO:{analytics:false}};
  assert.equal((await request(messages,{cookie:staffCookie})).status,403);
  assert.equal((await request(`${messages}/queue`,{method:'POST',cookie:staffCookie,body:{confirm:true,request_id:randomUUID()}})).status,403);
  assert.equal(calls.length,0);
});
it('queue action requires strict confirmation, UUID request, no client message, and CSRF',async()=>{
  const body={confirm:true,request_id:randomUUID()};const options={method:'POST',cookie:staffCookie,body};
  for(const extra of [{token:''},{token:'wrong'},{requestOrigin:'https://other.invalid'},{body:{...body,body:'arbitrary text'}},{body:{...body,confirm:false}},{body:{...body,request_id:'bad'}}]) assert.ok([400,403].includes((await request(`${messages}/queue`,{...options,...extra})).status));
  assert.equal(calls.length,0);
  assert.equal((await request(`${messages}/queue`,options)).status,200);
  assert.deepEqual(calls[0].input,{businessId,campaignId,request_id:body.request_id});
});
