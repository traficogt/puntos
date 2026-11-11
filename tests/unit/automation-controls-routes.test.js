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
const businessId=randomUUID(),otherBusiness=randomUUID(),staffId=randomUUID(),otherStaff=randomUUID();
const base='/api/admin/automations',csrf='fixture-automation-csrf';
const settings={birthday_enabled:true,birthday_points:40,birthday_monthly_points_cap:100,winback_enabled:false,winback_days:30,winback_points:0,winback_monthly_points_cap:0,minimum_contact_days:7,scheduler_hour_local:9,scheduler_tz:'America/Guatemala'};
const operations=[{path:'',method:'GET'},{path:'',method:'PUT',body:settings}];
let server,origin,ownerCookie,otherCookie,customerCookie,role,plan,overrides,calls;
const original={staff:StaffRepo.getById,business:BusinessRepo.getById,plans:PlanConfigService.getPlanFeatureOverrides,security:SecurityEventRepo.log};
before(async()=>{
 const module=await import('../../src/app/routes/automation-controls-routes.js').catch(()=>null);
 assert.equal(typeof module?.createAutomationControlsRoutes,'function','economics router must be implemented');
 StaffRepo.getById=async id=>({id,business_id:id===otherStaff?otherBusiness:businessId,role,active:true});
 BusinessRepo.getById=async id=>({id,plan});PlanConfigService.getPlanFeatureOverrides=async()=>overrides;SecurityEventRepo.log=async()=>{};
 const owner=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'});
 const other=await createBrowserSession({actorType:'STAFF',actorId:otherStaff,businessId:otherBusiness,role:'OWNER'});
 const customer=await createBrowserSession({actorType:'CUSTOMER',actorId:randomUUID(),businessId});
 ownerCookie=`${config.STAFF_COOKIE_NAME}=${owner.token}; pf_csrf=${csrf}`;otherCookie=`${config.STAFF_COOKIE_NAME}=${other.token}; pf_csrf=${csrf}`;customerCookie=`${config.CUSTOMER_COOKIE_NAME}=${customer.token}; pf_csrf=${csrf}`;
 const handler=kind=>async input=>{calls.push({kind,input});return {ok:true};};
 const app=express();app.use(express.json(),cookieParser());app.use('/api',module.createAutomationControlsRoutes({getAutomationControls:handler('get'),saveAutomationSettings:handler('settings'),getSecondVisitControls:handler('second-get'),saveSecondVisitSettings:handler('second-save'),getWeeklyBriefControls:handler('brief-get'),saveWeeklyBriefSettings:handler('brief-save'),previewWeeklyOwnerBrief:handler('brief-preview'),retryWeeklyOwnerBrief:handler('brief-retry'),requestOwnerBriefEmailVerification:handler('email-request'),confirmOwnerBriefEmailVerification:handler('email-confirm'),requestWeeklyOwnerBriefTest:handler('brief-test')}));app.use(notFoundRoute);app.use(errorHandler);
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
beforeEach(()=>{role='OWNER';plan='NEGOCIO';overrides={};calls=[];});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));StaffRepo.getById=original.staff;BusinessRepo.getById=original.business;PlanConfigService.getPlanFeatureOverrides=original.plans;SecurityEventRepo.log=original.security;});
async function request(path='',{method='GET',body=undefined,cookie=ownerCookie,token=csrf,requestOrigin=origin}={}){
 const res=await fetch(`${origin}${base}${path}`,{method,headers:{'Content-Type':'application/json','User-Agent':'automation-route-test',cookie,origin:requestOrigin,'x-csrf-token':token},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:res.status,body:await res.json(),cache:res.headers.get('cache-control')};
}
it('requires authenticated owners and lifecycle entitlement on reads and writes',async()=>{
 for(const cookie of ['',customerCookie])for(const op of operations)assert.equal((await request(op.path,{...op,cookie})).status,401);
 for(const value of ['CASHIER','MANAGER']){role=value;for(const op of operations)assert.equal((await request(op.path,op)).status,403);}
 role='OWNER';plan='EMPRENDEDOR';assert.equal((await request()).body.code,'PLAN_FEATURE_LOCKED');
 plan='NEGOCIO';overrides={NEGOCIO:{lifecycle_automation:false}};assert.equal((await request()).status,403);assert.equal(calls.length,0);
});
it('protects writes with CSRF and binds identity to authenticated session',async()=>{
 for(const change of [{token:''},{token:'wrong'},{cookie:ownerCookie.split(';')[0]},{requestOrigin:'https://unrelated.invalid'},{requestOrigin:''}])assert.equal((await request('',{method:'PUT',body:settings,...change})).status,403);
 assert.equal(calls.length,0);assert.equal((await request('',{method:'PUT',body:settings,cookie:otherCookie})).status,200);
 assert.equal(calls[0].input.businessId,otherBusiness);assert.equal(calls[0].input.staffId,otherStaff);assert.deepEqual(calls[0].input.settings,settings);
});
it('strictly validates bounded budgets, hours and payloads',async()=>{
 for(const patch of [{business_id:otherBusiness},{birthday_points:-1},{birthday_points:10001},{birthday_points:'40'},{birthday_monthly_points_cap:1},{birthday_monthly_points_cap:2000001},{minimum_contact_days:6},{minimum_contact_days:91},{scheduler_hour_local:18},{scheduler_tz:'UTC'},{winback_days:6}])assert.equal((await request('',{method:'PUT',body:{...settings,...patch}})).status,400,JSON.stringify(patch));
 for(const path of ['?x=1','?business_id=other'])assert.equal((await request(path)).status,400);
 assert.equal(calls.length,0);const result=await request();assert.equal(result.status,200);assert.equal(result.cache,'no-store');
});

it('offers separate strict owner-only controls for second visits and owner briefs',async()=>{
 const second={enabled:true,bonus_points:50,minimum_purchase_q:10,duration_days:7,monthly_points_cap:100,monthly_offer_cap:2};
 const brief={enabled:true,weekday:3,hour:10};
 const ops=[{path:'/second-visit',method:'GET'},{path:'/second-visit',method:'PUT',body:second},{path:'/owner-brief',method:'GET'},{path:'/owner-brief',method:'PUT',body:brief},{path:'/owner-brief/preview',method:'POST',body:{}},{path:`/owner-brief/${randomUUID()}/retry`,method:'POST',body:{}}];
 for(const op of ops){assert.equal((await request(op.path,op)).status,200,op.path);assert.equal(calls.at(-1).input.businessId,businessId);}
 for(const op of ops.filter(o=>o.method!=='GET'))assert.equal((await request(op.path,{...op,token:''})).status,403);
 for(const patch of [{recipient:'+50259999999'},{owner_id:randomUUID()},{hour:24},{weekday:0},{enabled:'true'}])assert.equal((await request('/owner-brief',{method:'PUT',body:{...brief,...patch}})).status,400);
 assert.equal((await request('/second-visit',{method:'PUT',body:{...second,monthly_points_cap:1}})).status,400);
 role='CASHIER';for(const op of ops)assert.equal((await request(op.path,op)).status,403);
});

it('strictly validates verified-email and explicit-test actions, with owner and CSRF checks',async()=>{
 const request_id=randomUUID();
 const ops=[{path:'/owner-brief/email-verification/request',body:{request_id}},{path:'/owner-brief/email-verification/confirm',body:{request_id,token:'a'.repeat(43)}},{path:'/owner-brief/test',body:{request_id}}];
 for(const op of ops){assert.equal((await request(op.path,{method:'POST',body:op.body})).status,200);assert.equal(calls.at(-1).input.requestId,request_id);assert.equal(calls.at(-1).input.staffId,staffId);assert.equal((await request(op.path,{method:'POST',body:{...op.body,to:'other@example.invalid'}})).status,400);assert.equal((await request(op.path,{method:'POST',body:op.body,token:''})).status,403);}
 role='MANAGER';for(const op of ops)assert.equal((await request(op.path,{method:'POST',body:op.body})).status,403);
});
