import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,beforeEach,it} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import {config} from '../../src/config/index.js';
import {StaffRepo} from '../../src/app/repositories/staff-repository.js';
import {SecurityEventRepo} from '../../src/app/repositories/security-event-repository.js';
import {createBrowserSession} from '../../src/app/services/auth-session-service.js';
import {defaultRequestBody,errorHandler} from '../../src/middleware/common.js';
import {createServiceCompletionRoutes} from '../../src/app/routes/service-completion-routes.js';
const businessId=randomUUID(),staffId=randomUUID(),id=randomUUID(),csrf='service-completion-test';let server,origin,cookie,role,calls;
const original={staff:StaffRepo.getById,security:SecurityEventRepo.log};
before(async()=>{
 StaffRepo.getById=async()=>({id:staffId,business_id:businessId,role,active:true,branch_id:null});SecurityEventRepo.log=async()=>{};
 const session=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'});cookie=`${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
 const deps=Object.fromEntries(['getAutomaticBriefing','acknowledgeAutomaticBriefing','getRehearsal','startRehearsal','advanceRehearsal'].map(key=>[key,async input=>{calls.push({key,input});return {ok:true};}]));
 const app=express();app.use(express.json(),defaultRequestBody,cookieParser());app.use('/api',createServiceCompletionRoutes(deps));app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${server.address().port}`;
});beforeEach(()=>{role='OWNER';calls=[];});after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));StaffRepo.getById=original.staff;SecurityEventRepo.log=original.security;});
async function request(path,method='GET',body,headers={}){const result=await fetch(`${origin}/api${path}`,{method,headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:result.status,cache:result.headers.get('cache-control'),body:await result.json()};}
it('requires owner for owner rehearsal and an authenticated staff identity for private briefing',async()=>{
 for(const prefix of ['admin','staff'])for(const suffix of ['briefing','rehearsal'])assert.equal((await request(`/${prefix}/service-operations/${suffix}`,'GET',undefined,{cookie:''})).status,401);
 role='CASHIER';assert.equal((await request('/admin/service-operations/rehearsal')).status,403);assert.equal((await request('/staff/service-operations/rehearsal')).status,200);assert.equal(calls.at(-1).input.staff.id,staffId);
});
it('checks CSRF, strict steps, request identity and version before persisting practice',async()=>{
 const base='/staff/service-operations',operations=/** @type {Array<[string,Record<string,unknown>]>} */([[`${base}/rehearsal`,{requestId:id}],[`${base}/rehearsal/${id}/step`,{requestId:id,version:1,action:'signup'}],[`${base}/briefing/${id}/ack`,{version:1}]]);
 for(const [path,body] of operations){assert.equal((await request(path,'POST',body,{'x-csrf-token':''})).status,403);assert.equal((await request(path,'POST',{...body,businessId:randomUUID()})).status,400);assert.equal((await request(path,'POST',body)).cache,'no-store');}
 assert.equal(calls[0].input.businessId,businessId);assert.equal(calls[1].input.staff.id,staffId);
 for(const body of [{requestId:id,version:0,action:'signup'},{requestId:id,version:1,action:'send_message'},{requestId:id,version:1,action:'earn',quantity:-1}])assert.equal((await request(`${base}/rehearsal/${id}/step`,'POST',body)).status,400);
});
