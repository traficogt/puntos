import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../src/config/index.js';
import { StaffRepo } from '../../src/app/repositories/staff-repository.js';
import { BusinessRepo } from '../../src/app/repositories/business-repository.js';
import { PlanConfigService } from '../../src/app/services/plan-config-service.js';
import { SecurityEventRepo } from '../../src/app/repositories/security-event-repository.js';
import { createBrowserSession } from '../../src/app/services/auth-session-service.js';
import { errorHandler, notFound as notFoundRoute } from '../../src/middleware/common.js';
import { notFound } from '../../src/utils/http-error.js';
const businessId=randomUUID(),otherBusiness=randomUUID(),staffId=randomUUID(),otherStaff=randomUUID(),rewardId=randomUUID();
const base='/api/admin/reward-economics',csrf='fixture-economics-csrf';
const settings={gross_margin_pct:40,cost_per_point_q:0.1},cost={unit_cost_q:4.5};
const operations=[{path:'',method:'GET'},{path:'/service-restorations',method:'GET'},{path:'/settings',method:'PUT',body:settings},{path:`/rewards/${rewardId}`,method:'PUT',body:cost}];
let server,origin,ownerCookie,otherCookie,customerCookie,impersonatedCookie,role,plan,overrides,calls;
const original={staff:StaffRepo.getById,business:BusinessRepo.getById,plans:PlanConfigService.getPlanFeatureOverrides,security:SecurityEventRepo.log};
before(async()=>{
 const module=await import('../../src/app/routes/reward-economics-routes.js').catch(()=>null);
 assert.equal(typeof module?.createRewardEconomicsRoutes,'function','economics router must be implemented');
 StaffRepo.getById=async id=>({id,business_id:id===otherStaff?otherBusiness:businessId,role,active:true});
 BusinessRepo.getById=async id=>({id,plan});PlanConfigService.getPlanFeatureOverrides=async()=>overrides;SecurityEventRepo.log=async()=>{};
 const owner=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'});
 const other=await createBrowserSession({actorType:'STAFF',actorId:otherStaff,businessId:otherBusiness,role:'OWNER'});
 const customer=await createBrowserSession({actorType:'CUSTOMER',actorId:randomUUID(),businessId});
 const impersonated=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER',impersonatedBy:'support@example.invalid'});
 impersonatedCookie=`${config.STAFF_COOKIE_NAME}=${impersonated.token}; pf_csrf=${csrf}`;
 ownerCookie=`${config.STAFF_COOKIE_NAME}=${owner.token}; pf_csrf=${csrf}`;otherCookie=`${config.STAFF_COOKIE_NAME}=${other.token}; pf_csrf=${csrf}`;customerCookie=`${config.CUSTOMER_COOKIE_NAME}=${customer.token}; pf_csrf=${csrf}`;
 const handler=kind=>async input=>{calls.push({kind,input});if(kind==='cost'&&input.businessId===otherBusiness)throw notFound('Recompensa no encontrada.');return {ok:true};};
 const app=express();app.use(express.json(),cookieParser());app.use('/api',module.createRewardEconomicsRoutes({getRewardEconomics:handler('get'),getServiceRestorationCosts:handler('restorations'),updateRewardEconomicsSettings:handler('settings'),updateRewardUnitCost:handler('cost')}));app.use(notFoundRoute);app.use(errorHandler);
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
beforeEach(()=>{role='OWNER';plan='NEGOCIO';overrides={};calls=[];});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));StaffRepo.getById=original.staff;BusinessRepo.getById=original.business;PlanConfigService.getPlanFeatureOverrides=original.plans;SecurityEventRepo.log=original.security;});
async function request(path='',{method='GET',body=undefined,cookie=ownerCookie,token=csrf,requestOrigin=origin}={}){
 const res=await fetch(`${origin}${base}${path}`,{method,headers:{'Content-Type':'application/json','User-Agent':'economics-route-test',cookie,origin:requestOrigin,'x-csrf-token':token},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:res.status,body:await res.json(),cache:res.headers.get('cache-control')};
}
it('requires owner sessions and analytics on all reads and writes',async()=>{
 for(const cookie of ['',customerCookie])for(const op of operations){const res=await request(op.path,{...op,cookie});assert.equal(res.status,401);assert.equal(res.cache,'no-store');}
 for(const value of ['CASHIER','MANAGER']){role=value;for(const op of operations)assert.equal((await request(op.path,op)).status,403);}
 role='OWNER';plan='EMPRENDEDOR';for(const op of operations)assert.equal((await request(op.path,op)).body.code,'PLAN_FEATURE_LOCKED');
 plan='NEGOCIO';overrides={NEGOCIO:{analytics:false}};for(const op of operations)assert.equal((await request(op.path,op)).body.code,'PLAN_FEATURE_LOCKED');assert.equal(calls.length,0);
 overrides={EMPRENDEDOR:{analytics:true}};plan='EMPRENDEDOR';assert.equal((await request()).status,200);
});
it('requires token, cookie and matching origin on each write',async()=>{
 for(const op of operations.filter(o=>o.method==='PUT'))for(const change of [{token:''},{token:'wrong'},{cookie:ownerCookie.split(';')[0]},{requestOrigin:'https://unrelated.invalid'},{requestOrigin:''}])assert.equal((await request(op.path,{...op,...change})).status,403);
 assert.equal(calls.length,0);
});
it('uses authenticated tenant and staff identity and rejects foreign reward lookup',async()=>{
 assert.equal((await request('?days=90&offset=50')).status,200);assert.deepEqual(calls.at(-1),{kind:'get',input:{businessId,days:90,offset:50}});
 assert.equal((await request('/settings',{method:'PUT',body:settings})).status,200);assert.deepEqual(calls.at(-1).input,{businessId,staffId,ip:'127.0.0.1',ua:'economics-route-test',grossMarginPct:40,costPerPointQ:0.1});
 assert.equal((await request(`/rewards/${rewardId.toUpperCase()}`,{method:'PUT',body:cost})).status,200);assert.equal(calls.at(-1).input.rewardId,rewardId);
 assert.equal((await request(`/rewards/${rewardId}`,{method:'PUT',body:cost,cookie:otherCookie})).status,404);assert.equal(calls.at(-1).input.businessId,otherBusiness);assert.equal(calls.at(-1).input.staffId,otherStaff);
});
it('binds restoration cost reads to the session tenant with a bounded period and no-store',async()=>{
 for(const [path,cookie,tenant,days] of [['/service-restorations',ownerCookie,businessId,30],['/service-restorations?days=90',otherCookie,otherBusiness,90]]){
  const response=await request(path,{cookie});assert.equal(response.status,200);assert.equal(response.cache,'no-store');
  assert.deepEqual(calls.at(-1),{kind:'restorations',input:{businessId:tenant,days}});
 }
});
it('rejects malformed periods and client tenant selection on restoration cost reads',async()=>{
 for(const query of ['?days=1','?days=030','?days=30&days=90','?days[x]=30','?offset=0','?business_id=other','?staff_id=other']){
  const response=await request(`/service-restorations${query}`);assert.equal(response.status,400,query);assert.equal(response.body.code,'VALIDATION_ERROR');assert.equal(response.cache,'no-store');
 }
 assert.equal(calls.length,0);
});
it('forwards impersonation from the authenticated session to both financial writes',async()=>{
 for(const op of operations.filter(value=>value.method==='PUT')){
  assert.equal((await request(op.path,{...op,cookie:impersonatedCookie})).status,200);
  assert.equal(calls.at(-1).input.impersonated_by,'support@example.invalid');
 }
});
it('rejects unbounded queries, duplicate fields, invalid identifiers and identity injection',async()=>{
 for(const path of ['?days=1','?days=30&days=90','?days[x]=30','?offset=-1','?offset=01','?offset=100001','?offset=1.1','?business_id=other'])assert.equal((await request(path)).status,400,path);
 for(const path of ['/rewards/invalid',`/rewards/${rewardId}?business_id=other`])assert.equal((await request(path,{method:'PUT',body:cost})).status,400,path);
 assert.equal((await request('/settings?business_id=other',{method:'PUT',body:settings})).status,400);assert.equal(calls.length,0);
});
it('validates nullable costs, decimal precision and explicit zero without coercion',async()=>{
 for(const unit_cost_q of [-1,1000000.01,0.001,'10',{},true])assert.equal((await request(`/rewards/${rewardId}`,{method:'PUT',body:{unit_cost_q}})).status,400,JSON.stringify(unit_cost_q));
 for(const body of [{},{...cost,business_id:otherBusiness},{...cost,points_cost:100}])assert.equal((await request(`/rewards/${rewardId}`,{method:'PUT',body})).status,400);
 for(const unit_cost_q of [null,0,4.57,1000000]){assert.equal((await request(`/rewards/${rewardId}`,{method:'PUT',body:{unit_cost_q}})).status,200);assert.equal(calls.at(-1).input.unitCostQ,unit_cost_q);}
});
it('bounds gross margin and point assumptions, requires explicit clearing and rejects extra fields',async()=>{
 for(const body of [{},{gross_margin_pct:40},{...settings,gross_margin_pct:101},{...settings,gross_margin_pct:-1},{...settings,gross_margin_pct:'40'},{...settings,gross_margin_pct:40.001},{...settings,cost_per_point_q:-1},{...settings,cost_per_point_q:1001},{...settings,cost_per_point_q:0.0000001},{...settings,business_id:otherBusiness}])assert.equal((await request('/settings',{method:'PUT',body})).status,400,JSON.stringify(body));
 assert.equal(calls.length,0);
 for(const body of [{gross_margin_pct:null,cost_per_point_q:null},{gross_margin_pct:0,cost_per_point_q:0},{gross_margin_pct:100,cost_per_point_q:1000}])assert.equal((await request('/settings',{method:'PUT',body})).status,200);
});
