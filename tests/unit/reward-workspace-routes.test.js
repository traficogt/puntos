import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import {StaffRepo} from '../../src/app/repositories/staff-repository.js';
import {SecurityEventRepo} from '../../src/app/repositories/security-event-repository.js';
import {createBrowserSession} from '../../src/app/services/auth-session-service.js';
import {errorHandler,notFound} from '../../src/middleware/common.js';
import {config} from '../../src/config/index.js';
import {saveRewardWorkspace,normalizeRewardWorkspace} from '../../src/app/services/reward-workspace-service.js';
import * as routes from '../../src/app/routes/reward-workspace-routes.js';
const businessId=randomUUID(),staffId=randomUUID(),csrf='fixture-workspace-csrf',base='/api/admin/reward-workspace';
const reward={name:'Cafe',description:null,points_cost:80,active:true,stock:null,valid_until:null,branch_ids:[]};
const body={requestId:randomUUID(),reward,unitCostQ:null,available:true};
let server,origin,cookie,role,active,calls;
const original={staff:StaffRepo.getById,security:SecurityEventRepo.log};
before(async()=>{
 assert.equal(typeof routes.createRewardWorkspaceRoutes,'function');StaffRepo.getById=async()=>({id:staffId,business_id:businessId,branch_id:null,role,active});SecurityEventRepo.log=async()=>{};
 const session=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'});cookie=`${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
 const app=express();app.use(express.json(),cookieParser());app.use('/api',routes.createRewardWorkspaceRoutes({getRewardWorkspace:async input=>{calls.push(input);return{ok:true};},saveRewardWorkspace:input=>saveRewardWorkspace(input,{getPlanFeatureOverrides:async()=>({}),transaction:async()=>{calls.push(input);return{ok:true};}})}));app.use(notFound,errorHandler);
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
beforeEach(()=>{role='OWNER';active=true;calls=[];});
after(async()=>{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));StaffRepo.getById=original.staff;SecurityEventRepo.log=original.security;});
/** @param {{path?:string,method?:string,body?:any,[key:string]:any}} [options] */
async function request({path=base,method='GET',body:input=undefined,...headers}={}){const response=await fetch(origin+path,{method,headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,...headers},body:input===undefined?undefined:JSON.stringify(input)});return{status:response.status,cache:response.headers.get('cache-control')};}
test('owner authentication and no-store cover reads and saves',async()=>{for(const method of ['GET','POST']){const operation={method,...(method==='POST'?{body}:{})};assert.deepEqual(await request({...operation,cookie:''}),{status:401,cache:'no-store'});for(const denied of ['MANAGER','CASHIER']){role=denied;assert.equal((await request(operation)).status,403);}}assert.equal(calls.length,0);});
test('save requires CSRF and uses authenticated tenant identity',async()=>{assert.equal((await request({method:'POST',body,'x-csrf-token':''})).status,403);assert.equal((await request({method:'POST',body,origin:'https://unrelated.invalid'})).status,403);assert.equal((await request({method:'POST',body})).status,200);assert.equal(calls[0].businessId,businessId);assert.equal(calls[0].staff.id,staffId);});
test('strict fields, edit versions, counts, dates and identities fail before transaction',async()=>{
 const invalid=[{businessId:randomUUID()},{rewardId:randomUUID()},{version:'a'.repeat(64)},{version:'stale',rewardId:randomUUID()},{available:'true'},{unitCostQ:-1},{unitCostQ:'0'},{unitCostQ:0.001},{reward:{...reward,points_cost:2147483648}},{reward:{...reward,name:'\n'}},{reward:{...reward,stock:-1}},{reward:{...reward,valid_until:'tomorrow'}},{reward:{...reward,branch_ids:[randomUUID(),'other']}},{mapping:{catalogItemId:randomUUID(),version:0}},{requestId:'bad'}];
 for(const patch of invalid)assert.equal((await request({method:'POST',body:{...body,...patch}})).status,400);
 for(const method of ['GET','POST'])assert.equal((await request({path:base+'?businessId='+randomUUID(),method,...(method==='POST'?{body}:{})})).status,400);assert.equal(calls.length,0);
});
test('omitted cost and null mapping retain distinct write intent while zero stays explicit',()=>{const omitted={requestId:randomUUID(),reward,available:true,mapping:null};assert.equal(Object.hasOwn(normalizeRewardWorkspace(omitted),'unitCostQ'),false);assert.equal(normalizeRewardWorkspace({...omitted,unitCostQ:0}).unitCostQ,0);assert.equal(normalizeRewardWorkspace({...omitted,unitCostQ:null}).unitCostQ,null);});
