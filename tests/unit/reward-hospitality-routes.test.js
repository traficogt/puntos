import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,beforeEach,after,it} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import {config} from '../../src/config/index.js';
import {StaffRepo} from '../../src/app/repositories/staff-repository.js';
import {SecurityEventRepo} from '../../src/app/repositories/security-event-repository.js';
import {createBrowserSession} from '../../src/app/services/auth-session-service.js';
import {errorHandler} from '../../src/middleware/common.js';
const businessId=randomUUID(),staffId=randomUUID(),id=randomUUID(),csrf='promise-hospitality-test';
let server,origin,cookie,customerCookie,role,calls;
const original={staff:StaffRepo.getById,security:SecurityEventRepo.log};
const grant={request_id:randomUUID(),staff_id:id,branch_id:null,reward_id:id,title:'Un café',total_units:3,total_cost:15,unit_cost_limit:5,starts_at:'2026-11-11T00:00:00Z',ends_at:'2026-11-12T00:00:00Z',valid_hours:48};
/** @type {Array<[string,string,Record<string,unknown>]>} */
const writes=[['/admin/hospitality','POST',grant],[`/admin/hospitality/${id}/revoke`,'POST',{}],[`/admin/reward-promises/${id}/availability`,'PUT',{available:false,alternative_reward_ids:[]}],['/staff/hospitality/issue','POST',{request_id:randomUUID(),customer_id:id,grant_id:id}],['/staff/reward-entitlements/redeem','POST',{request_id:randomUUID(),customer_id:id,promise_id:id}]];
before(async()=>{
 const a=await import('../../src/app/routes/reward-promise-routes.js'),b=await import('../../src/app/routes/hospitality-routes.js');
 StaffRepo.getById=async()=>({id:staffId,business_id:businessId,role,active:true,branch_id:null});SecurityEventRepo.log=async()=>{};
 cookie=`${config.STAFF_COOKIE_NAME}=${(await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'})).token}; pf_csrf=${csrf}`;
 customerCookie=`${config.CUSTOMER_COOKIE_NAME}=${(await createBrowserSession({actorType:'CUSTOMER',actorId:id,businessId})).token}`;
 const deps=Object.fromEntries(['getRewardPromisesOverview','configureRewardAvailability','listCustomerEntitlements','redeemEntitlement','listHospitality','createHospitalityGrant','revokeHospitalityGrant','issueHospitality'].map(key=>[key,async input=>{calls.push({key,input});return {ok:true};}]));
 const app=express();app.use(express.json(),cookieParser());app.use('/api',a.createRewardPromiseRoutes(deps),b.createHospitalityRoutes(deps));app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
beforeEach(()=>{role='OWNER';calls=[];});after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));StaffRepo.getById=original.staff;SecurityEventRepo.log=original.security;});
async function request(path,method='GET',body=undefined,headers={}){const res=await fetch(`${origin}/api${path}`,{method,headers:{cookie,'content-type':'application/json',origin,'x-csrf-token':csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,cache:res.headers.get('cache-control'),body:await res.json()};}
it('requires owner administration and authenticated no-store reads',async()=>{for(const path of ['/admin/reward-promises','/admin/hospitality','/staff/hospitality',`/staff/reward-entitlements?customer_id=${id}`]){const res=await request(path,'GET',undefined,{cookie:''});assert.equal(res.status,401);assert.equal(res.cache,'no-store');}role='CASHIER';for(const [path,method,body]of writes.filter(r=>r[0].startsWith('/admin/')))assert.equal((await request(path,method,body)).status,403);assert.equal((await request('/staff/hospitality')).status,200);});
it('requires csrf and prevents caller tenant or recipient injection',async()=>{for(const [path,method,body]of writes){assert.equal((await request(path,method,body,{'x-csrf-token':''})).status,403);assert.equal((await request(path,method,{...body,business_id:randomUUID()})).status,400);}assert.equal(calls.length,0);assert.equal((await request(`/customer/reward-entitlements?customer_id=${randomUUID()}`,'GET',undefined,{cookie:customerCookie})).status,400);assert.equal((await request('/customer/reward-entitlements','GET',undefined,{cookie:customerCookie})).status,200);assert.equal(calls[0].input.customerId,id);assert.equal(calls[0].input.businessId,businessId);});
it('maps strict authorized requests and requires exactly one entitlement',async()=>{for(const [path,method,body]of writes){const result=await request(path,method,body);assert.ok([200,201].includes(result.status),JSON.stringify(result));}assert.equal(calls[0].input.totalCost,15);assert.equal(calls.at(-1).input.promiseId,id);assert.equal(calls.at(-1).input.staff.id,staffId);for(const body of [{request_id:randomUUID(),customer_id:id},{request_id:randomUUID(),customer_id:id,promise_id:id,hospitality_id:id}])assert.equal((await request('/staff/reward-entitlements/redeem','POST',body)).status,400);});
