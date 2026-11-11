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
import * as services from '../../src/app/services/merchant-catalog-service.js';
import * as routes from '../../src/app/routes/merchant-catalog-routes.js';
const businessId=randomUUID(),staffId=randomUUID(),csrf='fixture-catalog-csrf',base='/api/admin/merchant-catalog';
const item={requestId:randomUUID(),productRef:'one',name:'One',itemKind:'product',active:true,revision:0};
const csv='productRef,name,itemKind\none,One,product';
const operations=[{path:base},{path:base+'/items',method:'PUT',body:item},{path:base+'/csv/preview',method:'POST',body:{csv}},{path:base+'/csv/import',method:'POST',body:{requestId:randomUUID(),csv}}];
let server,origin,cookie,role,active,calls;
const original={staff:StaffRepo.getById,security:SecurityEventRepo.log};
before(async()=>{
 assert.equal(typeof routes.createMerchantCatalogRoutes,'function');
 StaffRepo.getById=async()=>({id:staffId,business_id:businessId,branch_id:null,role,active});SecurityEventRepo.log=async()=>{};
 const session=await createBrowserSession({actorType:'STAFF',actorId:staffId,businessId,role:'OWNER'});cookie=`${config.STAFF_COOKIE_NAME}=${session.token}; pf_csrf=${csrf}`;
 const deps={listMerchantCatalog:async input=>{calls.push(input);return{ok:true};}};
 for(const name of ['saveManualCatalogItem','previewCatalogCsv','importCatalogCsv'])deps[name]=input=>services[name](input,{transaction:async()=>{calls.push(input);return{ok:true};}});
 const app=express();app.use(express.json(),cookieParser());app.use('/api',routes.createMerchantCatalogRoutes(deps));app.use(notFound,errorHandler);
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
});
beforeEach(()=>{role='OWNER';active=true;calls=[];});
after(async()=>{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));StaffRepo.getById=original.staff;SecurityEventRepo.log=original.security;});
/** @param {{path?:string,method?:string,body?:any,[key:string]:any}} [options] */
async function request({path=base,method='GET',body=undefined,...options}={}){const response=await fetch(origin+path,{method,headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,...options},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,cache:response.headers.get('cache-control')};}
test('all catalog operations require live owner session and prevent cached denials',async()=>{for(const operation of operations){assert.deepEqual(await request({...operation,cookie:''}),{status:401,cache:'no-store'});for(const deniedRole of ['MANAGER','CASHIER']){role=deniedRole;assert.equal((await request(operation)).status,403);}}assert.equal(calls.length,0);});
test('catalog writes require CSRF and derive tenant from session',async()=>{for(const operation of operations.filter(op=>op.method)){assert.equal((await request({...operation,'x-csrf-token':''})).status,403);assert.equal((await request({...operation,origin:'https://unrelated.invalid'})).status,403);assert.equal((await request(operation)).status,200);assert.equal(calls.at(-1).businessId,businessId);}});
test('search rejects unknown fields, duplicate query parameters and unbounded results',async()=>{for(const suffix of ['?limit=51','?offset=-1','?offset=100001','?source=a&source=b','?query='+ 'a'.repeat(101),'?businessId='+randomUUID(),'?branchId=nope'])assert.equal((await request({path:base+suffix})).status,400);assert.equal(calls.length,0);assert.equal((await request({path:base+'?limit=10&offset=20&query=Widget'})).status,200);assert.equal(calls[0].limit,10);});
test('writes reject tenant overrides and injected inventory evidence before transaction',async()=>{for(const operation of operations.filter(op=>op.method))assert.equal((await request({...operation,body:{...operation.body,businessId:randomUUID()}})).status,400);assert.equal((await request({...operations[1],body:{...item,availableQuantity:10}})).status,400);assert.equal((await request({...operations[1],path:operations[1].path+'?source=shop'})).status,400);assert.equal(calls.length,0);});
