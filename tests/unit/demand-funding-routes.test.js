import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,beforeEach,it} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import {config} from '../../src/config/index.js';
import {StaffRepo} from '../../src/app/repositories/staff-repository.js';
import {SecurityEventRepo} from '../../src/app/repositories/security-event-repository.js';
import {createBrowserSession} from '../../src/app/services/auth-session-service.js';
import {errorHandler} from '../../src/middleware/common.js';
import {createDemandFundingRoutes} from '../../src/app/routes/demand-funding-routes.js';
const businessId=randomUUID(),staffId=randomUUID(),customerId=randomUUID(),agreementId=randomUUID(),csrf='demand-funding-csrf';
const original={staff:StaffRepo.getById,security:SecurityEventRepo.log};
let server,origin,cookie,customerCookie,role,calls;
before(async()=>{
 StaffRepo.getById=async()=>({id:staffId,business_id:businessId,active:true,role});SecurityEventRepo.log=async()=>{};
 const staff=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'}),customer=await createBrowserSession({actorType:'CUSTOMER',actorId:customerId,businessId});
 cookie=`${config.STAFF_COOKIE_NAME}=${staff.token}; pf_csrf=${csrf}`;customerCookie=`${config.CUSTOMER_COOKIE_NAME}=${customer.token}; pf_csrf=${csrf}`;
 const handler=type=>async input=>{calls.push({type,input});return{ok:true};};
 const app=express();app.use(express.json(),cookieParser());app.use('/api',createDemandFundingRoutes(Object.fromEntries(['getDemandEntry','createDemandRequest','listDemandTopics','getDemandTopic','triageDemandTopic','getSupplierFunding','createSupplierAgreement','closeSupplierAgreement','listEligibleSupplierRedemptions','exportSupplierClaims','createSupplierClaim','getSupplierClaim','transitionSupplierClaim'].map(name=>[name,handler(name)]))));app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));StaffRepo.getById=original.staff;SecurityEventRepo.log=original.security;});
beforeEach(()=>{role='OWNER';calls=[];});
async function request(path,body,extra={}){const response=await fetch(`${origin}/api${path}`,{method:body?'POST':'GET',headers:{cookie,origin,'Content-Type':'application/json','x-csrf-token':csrf,...extra},body:body?JSON.stringify(body):undefined});return{status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};}
it('owner-only funding and triage routes reject staff and unauthenticated users',async()=>{role='CASHIER';for(const path of ['/admin/demand-notebook','/admin/supplier-funding']){assert.equal((await request(path)).status,403);assert.equal((await request(path,null,{cookie:''})).status,401);}assert.equal((await request('/staff/demand-notebook')).status,200);assert.equal(calls[0].input.businessId,businessId);});
it('customer requests derive tenant and member from session and reject identity injection',async()=>{const body={request_id:randomUUID(),category:'product',topic:'Otro café',note:'Sin azúcar'};assert.equal((await request('/customer/demand-notebook',body,{cookie:customerCookie})).status,200);assert.equal(calls[0].input.customerId,customerId);assert.equal(calls[0].input.businessId,businessId);for(const change of [{customer_id:randomUUID()},{businessId:randomUUID()},{source:'staff'}])assert.equal((await request('/customer/demand-notebook',{...body,...change},{cookie:customerCookie})).status,400);});
it('mutations require CSRF and exact bounded schemas',async()=>{const body={request_id:randomUUID(),redemption_id:randomUUID()};const path=`/admin/supplier-funding/agreements/${agreementId}/claims`;assert.equal((await request(path,body,{'x-csrf-token':''})).status,403);assert.equal((await request(path,{...body,amount_minor:10000})).status,400);assert.equal((await request(path,body)).status,200);assert.equal(calls[0].input.agreementId,agreementId);});
it('rejects stale-invalid versions, arbitrary filters and invalid dates before service calls',async()=>{for(const q of ['?offset=-1','?business_id=x','?offset=100001'])assert.equal((await request(`/admin/supplier-funding${q}`)).status,400);const path=`/admin/supplier-funding/claims/${randomUUID()}/transition`,body={request_id:randomUUID(),version:1,status:'paid',reference:'Transferencia',paid_minor:500,paid_at:'2026-11-12'};assert.equal((await request(path,{...body,version:0})).status,400);assert.equal((await request(path,{...body,paid_at:'2026-02-30'})).status,400);assert.equal(calls.length,0);assert.equal((await request(path,body)).cache,'no-store');});
