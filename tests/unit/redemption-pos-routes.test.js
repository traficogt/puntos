import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,beforeEach,after,it} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import {createRedemptionPosRoutes} from '../../src/app/routes/redemption-pos-routes.js';
import {recordManualFulfillment} from '../../src/app/services/redemption-pos-service.js';
import {saveRewardPosMapping} from '../../src/app/services/reward-pos-mapping-service.js';
import {StaffRepo} from '../../src/app/repositories/staff-repository.js';
import {SecurityEventRepo} from '../../src/app/repositories/security-event-repository.js';
import {createBrowserSession} from '../../src/app/services/auth-session-service.js';
import {errorHandler,notFound} from '../../src/middleware/common.js';
import {config} from '../../src/config/index.js';

const businessId=randomUUID(),otherBusinessId=randomUUID(),staffId=randomUUID(),otherStaffId=randomUUID(),branchId=randomUUID(),redemptionId=randomUUID(),rewardId=randomUUID();
const csrf='fixture-redemption-pos-csrf';
const manual={requestId:randomUUID(),version:0,action:'recorded',receiptRef:'Receipt 12',reason:'Recorded in the test POS.',attested:true};
const mapping={source:'odoo:fixture:1',branchId,productRef:'product.product:42',itemName:'Fixture reward',itemKind:'product',quantity:1,enabled:true,version:0};
const admin='/api/admin/redemption-pos',staff='/api/staff/redemption-pos',mappings='/api/admin/reward-pos-mappings';
const operations=[...[admin,staff].flatMap(base=>[{path:base},{path:`${base}/${redemptionId}`},{path:`${base}/${redemptionId}`,method:'POST',body:manual}]),{path:mappings},{path:`${mappings}/${rewardId}`,method:'PUT',body:mapping}];
let server,origin,ownerCookie,otherCookie,customerCookie,role,active,calls,transactions;
const original={staff:StaffRepo.getById,security:SecurityEventRepo.log};
before(async()=>{
 StaffRepo.getById=async id=>({id,business_id:id===otherStaffId?otherBusinessId:businessId,branch_id:branchId,role,active});
 SecurityEventRepo.log=async()=>{};
 const owner=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'});
 const other=await createBrowserSession({actorType:'STAFF',actorId:otherStaffId,businessId:otherBusinessId,role:'OWNER'});
 const customer=await createBrowserSession({actorType:'CUSTOMER',actorId:randomUUID(),businessId});
 ownerCookie=`${config.STAFF_COOKIE_NAME}=${owner.token}; pf_csrf=${csrf}`;
 otherCookie=`${config.STAFF_COOKIE_NAME}=${other.token}; pf_csrf=${csrf}`;
 customerCookie=`${config.CUSTOMER_COOKIE_NAME}=${customer.token}; pf_csrf=${csrf}`;
 const read=kind=>async input=>{calls.push({kind,input});return{ok:true};};
 // Real service validation runs before the transaction boundary. No database is used.
 const write=(kind,service)=>async input=>{calls.push({kind,input});return service(input,{transaction:async()=>{transactions.push({kind,input});return{ok:true};}});};
 const app=express();app.use(express.json(),cookieParser());
 app.use('/api',createRedemptionPosRoutes({listRedemptionPosRecords:read('list'),getRedemptionPosRecord:read('detail'),getRewardPosMappings:read('mappings'),recordManualFulfillment:write('manual',recordManualFulfillment),saveRewardPosMapping:write('mapping',saveRewardPosMapping)}));
 app.use(notFound,errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
beforeEach(()=>{role='OWNER';active=true;calls=[];transactions=[];});
after(async()=>{server?.closeAllConnections();await new Promise(r=>server?.close(r));StaffRepo.getById=original.staff;SecurityEventRepo.log=original.security;});
async function request(path,{method='GET',body=undefined,cookie=ownerCookie,token=csrf,requestOrigin=origin}={}){
 const response=await fetch(`${origin}${path}`,{method,headers:{'Content-Type':'application/json',cookie,origin:requestOrigin,'x-csrf-token':token},body:body===undefined?undefined:JSON.stringify(body)});
 return{status:response.status,body:await response.json(),cache:response.headers.get('cache-control'),referrer:response.headers.get('referrer-policy')};
}
it('requires staff authentication on every read and write and prevents caching denials',async()=>{
 for(const cookie of ['',customerCookie])for(const operation of operations){const out=await request(operation.path,{...operation,cookie});assert.equal(out.status,401,operation.path);assert.equal(out.cache,'no-store');}
 assert.equal(calls.length,0);assert.equal(transactions.length,0);
});
it('uses the live staff role: managers/cashiers cannot access owner routes but can use permitted staff routes',async()=>{
 for(const value of ['MANAGER','CASHIER']){
  role=value;
  for(const operation of operations){const out=await request(operation.path,operation);assert.equal(out.status,operation.path.startsWith('/api/admin/')?403:200,`${value} ${operation.path}`);assert.equal(out.cache,'no-store');}
 }
 assert.ok(calls.every(call=>call.kind!=='mappings'&&call.kind!=='mapping'));
 role='UNRECOGNIZED';calls=[];
 for(const operation of operations)assert.equal((await request(operation.path,operation)).status,403);
 assert.equal(calls.length,0);
});
it('requires CSRF cookie/token and trusted origin for each mutation',async()=>{
 for(const operation of operations.filter(op=>op.method))for(const change of [{token:''},{token:'mismatch'},{cookie:ownerCookie.split(';')[0]},{requestOrigin:''},{requestOrigin:'https://unrelated.invalid'}]){
  const out=await request(operation.path,{...operation,...change});assert.equal(out.status,403,operation.path);assert.equal(out.cache,'no-store');
 }
 assert.equal(calls.length,0);assert.equal(transactions.length,0);
});
it('derives business, staff and branch only from the authenticated session',async()=>{
 for(const cookie of [ownerCookie,otherCookie])for(const operation of operations){
  const out=await request(operation.path,{...operation,cookie});assert.equal(out.status,200);
  const call=calls.at(-1),other=cookie===otherCookie;
  assert.equal(call.input.businessId,other?otherBusinessId:businessId);
  assert.deepEqual(call.input.staff,{id:other?otherStaffId:staffId,business_id:other?otherBusinessId:businessId,role:'OWNER',branch_id:branchId,impersonated_by:null});
  if(operation.path.includes('/redemption-pos/'))assert.equal(call.input.redemptionId,redemptionId);
  if(operation.path.endsWith(rewardId))assert.equal(call.input.rewardId,rewardId);
  if(operation.path.includes('/redemption-pos'))assert.equal(out.referrer,'no-referrer');
 }
 assert.deepEqual(calls.find(call=>call.kind==='list').input,{businessId,staff:{id:staffId,business_id:businessId,role:'OWNER',branch_id:branchId,impersonated_by:null},status:'pending',code:'',offset:0});
});
it('rejects invalid IDs, duplicated query values, unsupported states and oversized pagination before service dispatch',async()=>{
 for(const base of [admin,staff]){
  for(const suffix of ['?status=deleted','?status=pending&status=recorded','?offset=-1','?offset=01','?offset=1.5','?offset=100001','?offset=','?offset=0&offset=50','?offset[x]=1','?code=Z','?code='+'A'.repeat(17),'?code=A&code=B','?businessId='+otherBusinessId,'?branchId='+branchId,'?limit=500','/not-uuid',`/${redemptionId}?unknown=true`])assert.equal((await request(base+suffix)).status,400,base+suffix);
  assert.equal((await request(base+'/not-uuid',{method:'POST',body:manual})).status,400);
  assert.equal((await request(`${base}/${redemptionId}?businessId=${otherBusinessId}`,{method:'POST',body:manual})).status,400);
 }
 assert.equal((await request(mappings+'?businessId='+otherBusinessId)).status,400);
 assert.equal((await request(mappings+'/invalid',{method:'PUT',body:mapping})).status,400);
 assert.equal((await request(`${mappings}/${rewardId}?version=1`,{method:'PUT',body:mapping})).status,400);
 assert.equal(calls.length,0);
 for(const status of ['all','pending','recorded','not_required','review','reviewed','unknown'])assert.equal((await request(`${admin}?status=${status}&code=ab12&offset=100000`)).status,200);
 assert.equal(calls.at(-1).input.offset,100000);assert.equal(calls.at(-1).input.code,'ab12');
});
it('manual payloads must pass actual service validation before any transaction begins',async()=>{
 for(const base of [admin,staff])for(const body of [{},{...manual,requestId:'invalid'},{...manual,version:-1},{...manual,version:2147483647},{...manual,version:'0'},{...manual,attested:false},{...manual,attested:'true'},{...manual,reason:'  '},{...manual,reason:'a'.repeat(501)},{...manual,receiptRef:''},{...manual,receiptRef:'a'.repeat(201)},{...manual,receiptRef:'bad\u0000ref'},{...manual,action:'stock_updated'},{...manual,businessId:otherBusinessId},{...manual,staff:{role:'OWNER'}},{...manual,stockStatus:'done'}]){
  const out=await request(`${base}/${redemptionId}`,{method:'POST',body});assert.equal(out.status,400,JSON.stringify(body));assert.equal(out.cache,'no-store');
 }
 assert.equal(transactions.length,0);
 for(const action of ['recorded','not_required','review','reviewed'])assert.equal((await request(`${admin}/${redemptionId}`,{method:'POST',body:{...manual,action}})).status,200);
 assert.equal(transactions.length,4);
});
it('mapping payloads enforce bounded references, precision, strict identities and explicit enablement',async()=>{
 for(const body of [{},{...mapping,source:'manual'},{...mapping,source:'system'},{...mapping,source:'a'.repeat(181)},{...mapping,branchId:'invalid'},{...mapping,productRef:''},{...mapping,productRef:'a'.repeat(201)},{...mapping,itemName:'a'.repeat(151)},{...mapping,itemKind:'inventory'},{...mapping,quantity:0},{...mapping,quantity:-1},{...mapping,quantity:1000001},{...mapping,quantity:0.0000001},{...mapping,quantity:'1'},{...mapping,version:-1},{...mapping,version:2147483647},{...mapping,enabled:'true'},{...mapping,businessId:otherBusinessId},{...mapping,rewardId:randomUUID()}]){
  assert.equal((await request(`${mappings}/${rewardId}`,{method:'PUT',body})).status,400,JSON.stringify(body));
 }
 assert.equal(transactions.length,0);
 assert.equal((await request(`${mappings}/${rewardId}`,{method:'PUT',body:{...mapping,branchId:null,quantity:0.000001,enabled:false}})).status,200);assert.equal(transactions.length,1);
});
it('does not expose deletes or bypass mutations on list endpoints',async()=>{
 for(const operation of [{path:admin,method:'POST',body:manual},{path:staff,method:'POST',body:manual},{path:`${admin}/${redemptionId}`,method:'DELETE'},{path:`${mappings}/${rewardId}`,method:'DELETE'},{path:`${admin}/${redemptionId}`,method:'PATCH',body:manual}])assert.equal((await request(operation.path,operation)).status,404);
 assert.equal(calls.length,0);
});
it('canonicalizes redemption UUIDs before passing them to shared ledger evidence lookup',async()=>{
 for(const base of [admin,staff]){
  assert.equal((await request(`${base}/${redemptionId.toUpperCase()}`)).status,200);
  assert.equal(calls.at(-1).input.redemptionId,redemptionId);
  assert.equal((await request(`${base}/${redemptionId.toUpperCase()}`,{method:'POST',body:manual})).status,200);
  assert.equal(calls.at(-1).input.redemptionId,redemptionId);
 }
});
