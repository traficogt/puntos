import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../../src/middleware/common.js';
import { SecurityEventRepo } from '../../src/app/repositories/security-event-repository.js';

test('acquisition owner APIs enforce tenant, role, plan, strict writes and CSRF',async t=>{
  const {createAdminAcquisitionRoutes}=await import('../../src/app/routes/admin/acquisition-routes.js');
  t.mock.method(SecurityEventRepo,'log',async()=>{});
  const business={id:'own',slug:'one',plan:'NEGOCIO'}, calls=[]; let overrides={};
  const source={id:'11111111-1111-4111-8111-111111111111',business_id:'own',code:'abcdefghijklmnop'};
  const app=express();app.use(express.json());app.use(cookieParser());
  app.use('/api',createAdminAcquisitionRoutes({
    getBusiness:async id=>{assert.equal(id,'own');return business;},getPlanFeatureOverrides:async()=>overrides,
    staffAuth:(req,res,next)=>{if(!req.get('x-role'))return res.sendStatus(401);req.staff={id:'owner',business_id:'own',role:req.get('x-role')};next();},
    service:{listSources:async b=>{calls.push(b.id);return {sources:[source]};},report:async b=>{calls.push(b.id);return {sources:[source]};},createSource:async(b,body)=>{calls.push([b.id,body]);return source;}},
    appOrigin:'https://puntos.example'
  }));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const origin=`http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  const request=(path='',{role='OWNER',body=/** @type {any} */(undefined),csrf=true}={})=>fetch(`${origin}/api/admin/acquisition${path}`,{method:body===undefined?'GET':'POST',headers:{...(role?{'x-role':role}:{}),'content-type':'application/json',origin,...(csrf?{cookie:'pf_csrf=test-token','x-csrf-token':'test-token'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try {
    for(const role of ['', 'CASHIER','MANAGER'])for(const path of ['', '/sources'])assert.equal((await request(path,{role})).status,role?403:401);
    assert.deepEqual(calls,[]);
    assert.equal((await request()).status,200);assert.equal((await request('/sources')).status,200);
    assert.equal((await request('?business_id=other')).status,400);
    assert.equal((await request('/sources',{body:{name:'A',request_id:source.id},csrf:false})).status,403);
    for(const body of [{name:'A',request_id:source.id,business_id:'other'},{name:'',request_id:source.id},{name:'A',request_id:source.id,branch_id:'bad'},{}])assert.equal((await request('/sources',{body})).status,400);
    const saved=await request('/sources',{body:{name:' A ',request_id:source.id}});assert.equal(saved.status,201);assert.match((await saved.json()).source.registration_url,/origen=abcdefghijklmnop$/);
    business.plan='EMPRENDEDOR';overrides={EMPRENDEDOR:{analytics:false}};
    assert.equal((await request()).status,403);assert.equal((await request('/sources',{body:{name:'A',request_id:source.id}})).status,403);
    business.plan='UNKNOWN';overrides={};assert.equal((await request()).status,403);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('public visit accepts only source code and never collects visitor identity',async()=>{
  const {createAcquisitionPublicRoutes}=await import('../../src/app/routes/acquisition-public-routes.js');
  const app=express();app.use(express.json());const calls=[];
  app.use('/api',createAcquisitionPublicRoutes({getBusiness:async slug=>slug==='one'?{id:'own',slug}:null,rateLimit:(_q,_r,next)=>next(),visit:async(b,code)=>{calls.push([b,code]);return {ok:true,visit_token:null};}}));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const origin=`http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  const visit=(body,slug='one')=>fetch(`${origin}/api/public/business/${slug}/acquisition/visit`,{method:'POST',headers:{'content-type':'application/json','user-agent':'ignored'},body:JSON.stringify(body)});
  try{
    assert.equal((await visit({source_code:'abcdefghijklmnop',business_id:'other'})).status,400);
    assert.equal((await visit({source_code:'old'})).status,200);
    assert.equal((await visit({source_code:'abcdefghijklmnop'},'missing')).status,200);
    const result=await visit({source_code:'abcdefghijklmnop'});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
    assert.deepEqual(calls,[[{id:'own',slug:'one'},'abcdefghijklmnop']]);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
