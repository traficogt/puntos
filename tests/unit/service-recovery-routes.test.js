import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,beforeEach,it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../src/config/index.js';
import { StaffRepo } from '../../src/app/repositories/staff-repository.js';
import { BusinessRepo } from '../../src/app/repositories/business-repository.js';
import { SecurityEventRepo } from '../../src/app/repositories/security-event-repository.js';
import { createBrowserSession } from '../../src/app/services/auth-session-service.js';
import { errorHandler } from '../../src/middleware/common.js';
const businessId=randomUUID(),staffId=randomUUID(),caseId=randomUUID(),customerId=randomUUID(),csrf='service-case-csrf';
const original={staff:StaffRepo.getById,business:BusinessRepo.getById,security:SecurityEventRepo.log};
let server,origin,cookie,role,calls;
before(async()=>{
 const mod=await import('../../src/app/routes/service-recovery-routes.js').catch(()=>null);assert.equal(typeof mod?.createServiceRecoveryRoutes,'function');
 StaffRepo.getById=async()=>({id:staffId,business_id:businessId,active:true,role});BusinessRepo.getById=async()=>({id:businessId});SecurityEventRepo.log=async()=>{};
 const session=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'});cookie=`${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
 const handler=type=>async input=>{calls.push({type,input});return {ok:true};};
 const app=express();app.use(express.json(),cookieParser());app.use('/api',mod.createServiceRecoveryRoutes({listServiceCases:handler('list'),getServiceCase:handler('get'),createServiceCase:handler('create'),resolveServiceCase:handler('resolve'),listServiceRedemptions:handler('redemptions')}));app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));StaffRepo.getById=original.staff;BusinessRepo.getById=original.business;SecurityEventRepo.log=original.security;});
beforeEach(()=>{role='OWNER';calls=[];});
async function request(path,body,extra={}){const response=await fetch(`${origin}/api${path}`,{method:body?'POST':'GET',headers:{cookie,origin,'Content-Type':'application/json','x-csrf-token':csrf,...extra},body:body?JSON.stringify(body):undefined});return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};}
it('requires owner for owner routes and allows authenticated counter staff scope',async()=>{role='CASHIER';assert.equal((await request('/admin/service-cases')).status,403);const result=await request('/staff/service-cases');assert.equal(result.status,200);assert.equal(result.cache,'no-store');assert.equal(calls[0].input.businessId,businessId);assert.equal(calls[0].input.staff.role,'CASHIER');assert.equal((await request('/staff/service-cases',null,{cookie:''})).status,401);});
it('requires CSRF and accepts only bounded exact case inputs',async()=>{const body={customerId,kind:'unavailable',reason:'No disponible hoy.',requestId:randomUUID()};assert.equal((await request('/staff/service-cases',body,{'x-csrf-token':''})).status,403);for(const change of [{businessId:randomUUID()},{reason:''},{kind:'invented'},{requestId:'invalid'}])assert.equal((await request('/staff/service-cases',{...body,...change})).status,400);assert.equal((await request('/staff/service-cases',body)).status,200);assert.equal(calls.length,1);});
it('requires optimistic version and explicit resolution with no balance amount supplied',async()=>{const body={version:1,resolution:'points_restored',reason:'No se entregó.',requestId:randomUUID()};for(const change of [{version:0},{points:900},{resolution:'free_points'}])assert.equal((await request(`/admin/service-cases/${caseId}/resolve`,{...body,...change})).status,400);assert.equal((await request(`/admin/service-cases/${caseId}/resolve`,body)).status,200);assert.equal(calls[0].input.caseId,caseId);assert.equal(calls[0].input.businessId,businessId);});
it('rejects arbitrary query identity injection and bounds pagination',async()=>{for(const query of ['?offset=-1','?status=no','?businessId=x','?offset=100001'])assert.equal((await request(`/staff/service-cases${query}`)).status,400);assert.equal((await request(`/staff/service-redemptions?customerId=${customerId}`)).status,200);assert.equal(calls[0].input.customerId,customerId);});
