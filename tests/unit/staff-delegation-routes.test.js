import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../src/config/index.js';
import { StaffRepo } from '../../src/app/repositories/staff-repository.js';
import { SecurityEventRepo } from '../../src/app/repositories/security-event-repository.js';
import { createBrowserSession } from '../../src/app/services/auth-session-service.js';
import { defaultRequestBody, errorHandler } from '../../src/middleware/common.js';
const businessId=randomUUID(),staffId=randomUUID(),id=randomUUID(),csrf='staff-authority-test';
let server,origin,cookie,role,calls;
const original={staff:StaffRepo.getById,security:SecurityEventRepo.log};
const grant={request_id:randomUUID(),staff_id:id,branch_id:null,action:'restore_redemption',per_action_points:50,total_points:100,starts_at:'2026-11-11T00:00:00Z',ends_at:'2026-11-12T00:00:00Z'};
const notice={title:'Aviso de turno',body:'Revisar el código.',branch_id:null,expires_at:'2026-11-12T00:00:00Z'};
/** @type {Array<[string, string, Record<string, unknown>]>} */
const writes=[['/admin/staff-authority','POST',grant],[`/admin/staff-authority/${id}/revoke`,'POST',{}],['/admin/shift-notices','POST',notice],[`/admin/shift-notices/${id}`,'PUT',{...notice,expected_version:1}],[`/staff/shift-briefing/${id}/ack`,'POST',{version:1}]];
before(async()=>{
 const module=await import('../../src/app/routes/staff-delegation-routes.js').catch(()=>null);assert.equal(typeof module?.createStaffDelegationRoutes,'function','staff delegation router exists');
 StaffRepo.getById=async()=>({id:staffId,business_id:businessId,role,active:true,branch_id:null});SecurityEventRepo.log=async()=>{};
 const session=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER',impersonatedBy:'support@example.test'});cookie=`${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
 const deps=Object.fromEntries(['createServiceGrant','listServiceGrants','revokeServiceGrant','getOwnServiceAuthority','publishShiftNotice','listShiftNotices','getShiftBriefing','acknowledgeShiftNotice'].map(key=>[key,async input=>{calls.push({key,input});return {ok:true};}]));
 const app=express();app.use(express.json(),defaultRequestBody,cookieParser());app.use('/api',module.createStaffDelegationRoutes(deps));app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
beforeEach(()=>{role='OWNER';calls=[];});after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));StaffRepo.getById=original.staff;SecurityEventRepo.log=original.security;});
async function request(path,method='GET',body,changes={}){const res=await fetch(`${origin}/api${path}`,{method,headers:{cookie,'content-type':'application/json',origin,'x-csrf-token':csrf,...changes},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,cache:res.headers.get('cache-control'),body:await res.json()};}
it('requires owner for management but permits self briefing with authenticated staff',async()=>{
 for(const path of ['/admin/staff-authority','/admin/shift-notices','/staff/service-authority','/staff/shift-briefing']){const res=await request(path,'GET',undefined,{cookie:''});assert.equal(res.status,401);assert.equal(res.cache,'no-store');}
 role='CASHIER';assert.equal((await request('/admin/staff-authority')).status,403);assert.equal((await request('/admin/shift-notices')).status,403);for(const op of writes.filter(row=>row[0].startsWith('/admin')))assert.equal((await request(...op)).status,403);
 assert.equal((await request('/staff/service-authority')).status,200);assert.equal((await request('/staff/shift-briefing')).status,200);
});
it('requires CSRF on every mutation and forbids request identity injection',async()=>{
 for(const op of writes)assert.equal((await request(...op,{'x-csrf-token':''})).status,403);
 for(const [path,method,body] of writes)assert.equal((await request(path,method,{...body,business_id:randomUUID(),staff_id:staffId})).status,400);
 assert.equal((await request('/admin/staff-authority?business_id=other')).status,400);assert.equal(calls.length,0);
});
it('maps strict values and session impersonation; acknowledges only its own version',async()=>{
 for(const op of writes)assert.equal((await request(...op)).status,op[1]==='POST'&&['/admin/staff-authority','/admin/shift-notices'].includes(op[0])?201:200);
 assert.equal(calls[0].input.staffId,id);assert.equal(calls[0].input.requestId,grant.request_id);assert.equal(calls[0].input.businessId,businessId);assert.equal(calls[0].input.staff.impersonated_by,'support@example.test');assert.equal(calls.at(-1).input.staff.id,staffId);assert.equal(calls.at(-1).input.version,1);
 for(const body of [{},{version:0},{version:'1'},{version:1,staff_id:id}])assert.equal((await request(`/staff/shift-briefing/${id}/ack`,'POST',body)).status,400);
 for(const request_id of [undefined,null,'invalid'])assert.equal((await request('/admin/staff-authority','POST',{...grant,request_id})).status,400);
 assert.equal((await request('/admin/staff-authority','POST',{...grant,total_points:1.5})).status,400);assert.equal((await request('/admin/staff-authority/invalid/revoke','POST',{})).status,400);
});
it('preserves bodyless revoke requests while enforcing authentication and CSRF',async()=>{
 const path=`${origin}/api/admin/staff-authority/${id}/revoke`;
 const send=headers=>fetch(path,{method:'POST',headers});
 assert.equal((await send({cookie,origin,'x-csrf-token':csrf})).status,200);
 assert.equal(calls.length,1);assert.equal(calls[0].key,'revokeServiceGrant');assert.equal(calls[0].input.businessId,businessId);
 assert.equal((await send({origin,'x-csrf-token':csrf})).status,401);
 assert.equal((await send({cookie,origin})).status,403);
 assert.equal(calls.length,1);
});
