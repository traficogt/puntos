import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createNativeWalletRoutes } from '../../src/app/routes/native-wallet-routes.js';
import { errorHandler } from '../../src/middleware/common.js';
import { unauthorized } from '../../src/utils/http-error.js';
import { safeLogUrl } from '../../src/utils/logger.js';

const serial='11111111-1111-4111-8111-111111111111';
const path=`/api/wallet/apple/v1/devices/device12345678/registrations/pass.com.pf/${serial}`;
const token='a'.repeat(43);

test('Wallet protocol and customer routes enforce separate authorization boundaries',async t=>{
  const calls=[];
  let updatedPass={bytes:Buffer.from('updated-pass'),revision:'8',updatedAt:new Date('2026-11-09T12:00:00.100Z')};
  const service={
    status:async()=>({providers:{apple:true,google:false},passes:[]}),
    issue:async(_auth,provider)=>({url:provider==='apple'?'/api/customer/wallet/apple/download':'https://pay.google.com/gp/v/save/signed'}),
    revoke:async()=>({ok:true}), downloadApple:async()=>Buffer.from('signed-pkpass'),
    requireProvider:()=>{},authenticateApple:async(type,serial,header)=>{
      if(type!=='pass.com.pf'||header!==`ApplePass ${token}`)throw unauthorized();return{id:serial};
    },updatedApplePass:async()=>updatedPass
  };
  const repo={registerDevice:async data=>{calls.push(data);return{created:true};},unregisterDevice:async()=>{},getDeviceUpdates:async(_id,_type,since)=>({serial_numbers:since==='8'?[]:[serial],last_updated:'8'})};
  const app=express();app.use(express.json());
  app.use('/api',createNativeWalletRoutes({service:/** @type {any} */(service),repo:/** @type {any} */(repo),settings:/** @type {any} */({apple:{config:{passTypeIdentifier:'pass.com.pf'}}}),globalContext:async fn=>fn(),tenant:(_req,_res,next)=>next(),customerAuth:(req,_res,next)=>{
    if(req.get('X-Test-Customer')!=='yes')return next(unauthorized());req.customerAuth={id:'customer',business_id:'business'};next();
  },csrf:(req,_res,next)=>req.get('X-Test-Csrf')==='yes'?next():next(Object.assign(Error('CSRF'),{statusCode:403}))}));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */(server.address()).port}`;
  try{
    await t.test('customer routes require session and writes require CSRF',async()=>{
      assert.equal((await fetch(`${base}/api/customer/wallet`)).status,401);
      assert.equal((await fetch(`${base}/api/customer/wallet/apple`,{method:'POST',headers:{'X-Test-Customer':'yes'}})).status,403);
      const res=await fetch(`${base}/api/customer/wallet/apple`,{method:'POST',headers:{'X-Test-Customer':'yes','X-Test-Csrf':'yes'}});
      assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.deepEqual(await res.json(),{url:'/api/customer/wallet/apple/download'});
      const file=await fetch(`${base}/api/customer/wallet/apple/download`,{headers:{'X-Test-Customer':'yes'}});
      assert.match(file.headers.get('content-type'),/application\/vnd.apple.pkpass/);assert.equal(await file.text(),'signed-pkpass');
    });
    await t.test('Apple registers using pass authorization without browser CSRF or cookies',async()=>{
      assert.equal((await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pushToken:'f'.repeat(64)})})).status,401);
      const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',Authorization:`ApplePass ${token}`},body:JSON.stringify({pushToken:'f'.repeat(64)})});
      assert.equal(res.status,201);assert.equal(calls.length,1);assert.equal(calls[0].passId,serial);
      assert.equal((await fetch(base+path,{method:'DELETE',headers:{Authorization:`ApplePass ${token}`}})).status,200);
    });
    await t.test('Apple updates use opaque device capability, validate tag and produce native JSON',async()=>{
      const list=path.slice(0,-37);
      assert.deepEqual(await(await fetch(base+list)).json(),{serialNumbers:[serial],lastUpdated:'8'});
      assert.equal((await fetch(base+list+'?passesUpdatedSince=8')).status,204);
      assert.equal((await fetch(base+list+'?passesUpdatedSince=9223372036854775808')).status,400);
      const passUrl=`${base}/api/wallet/apple/v1/passes/pass.com.pf/${serial}`;
      const response=await fetch(passUrl,{headers:{Authorization:`ApplePass ${token}`}});
      assert.equal(response.status,200);assert.equal(await response.text(),'updated-pass');
      assert.equal((await fetch(passUrl,{headers:{Authorization:`ApplePass ${token}`,'If-None-Match':'"wallet-8"'}})).status,304);
    });
    await t.test('Apple date-only refresh cannot miss a newer revision in the same second',async()=>{
      const passUrl=`${base}/api/wallet/apple/v1/passes/pass.com.pf/${serial}`;
      const first=await fetch(passUrl,{headers:{Authorization:`ApplePass ${token}`}});
      const lastModified=first.headers.get('last-modified');
      await first.arrayBuffer();
      updatedPass={bytes:Buffer.from('newer-pass'),revision:'9',updatedAt:new Date('2026-11-09T12:00:00.900Z')};
      // Fetch adds Cache-Control:no-cache for conditional requests. Native Wallet
      // sends the HTTP validator directly, so use raw HTTP to exercise Express.
      const refresh=await new Promise((resolve,reject)=>{
        http.get(passUrl,{headers:{Authorization:`ApplePass ${token}`,'If-Modified-Since':lastModified}},response=>{
          const chunks=[];
          response.on('data',chunk=>chunks.push(chunk));
          response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString()}));
          response.on('error',reject);
        }).on('error',reject);
      });
      assert.equal(refresh.status,200);
      assert.equal(refresh.body,'newer-pass');
      assert.equal((await fetch(passUrl,{headers:{Authorization:`ApplePass ${token}`,'If-None-Match':'"wallet-9"'}})).status,304);
      assert.equal((await fetch(passUrl,{headers:{'If-Modified-Since':lastModified}})).status,401);
    });
    await t.test('Apple conditional responses require revision tags and tolerate ambiguous dates',async()=>{
      const passUrl=`${base}/api/wallet/apple/v1/passes/pass.com.pf/${serial}`;
      const headers={Authorization:`ApplePass ${token}`};
      updatedPass={bytes:Buffer.from('latest-pass'),revision:'10',updatedAt:new Date('2026-11-09T12:00:02.000Z')};
      const sameDate=updatedPass.updatedAt.toUTCString();
      const unchanged=await fetch(passUrl,{headers:{...headers,'If-Modified-Since':sameDate}});
      assert.equal(unchanged.status,200);
      assert.equal(unchanged.headers.get('last-modified'),sameDate);
      await unchanged.arrayBuffer();
      const outdatedTag=await fetch(passUrl,{headers:{...headers,'If-None-Match':'"wallet-9"','If-Modified-Since':sameDate}});
      assert.equal(outdatedTag.status,200);
      assert.equal(await outdatedTag.text(),'latest-pass');
      assert.equal((await fetch(passUrl,{headers:{...headers,'If-None-Match':'"old", W/"wallet-10"','If-Modified-Since':'invalid'}})).status,304);
      const invalid=await fetch(passUrl,{headers:{...headers,'If-Modified-Since':'invalid'}});
      assert.equal(invalid.status,200);
      await invalid.arrayBuffer();
      // PostgreSQL now() reflects transaction start, so a later committed
      // revision can have an earlier timestamp after waiting on a row lock.
      updatedPass={bytes:Buffer.from('later-revision'),revision:'11',updatedAt:new Date('2026-11-09T12:00:01.100Z')};
      const earlierTimestamp=await fetch(passUrl,{headers:{...headers,'If-Modified-Since':sameDate}});
      assert.equal(earlierTimestamp.status,200);
      assert.equal(await earlierTimestamp.text(),'later-revision');
    });
    await t.test('bounded Apple diagnostics are accepted without retention',async()=>{
      const res=await fetch(`${base}/api/wallet/apple/v1/log`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logs:['diagnostic']})});assert.equal(res.status,200);
      assert.equal((await fetch(`${base}/api/wallet/apple/v1/log`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logs:['x'.repeat(1001)]})})).status,400);
    });
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Apple device capabilities and serials do not enter HTTP logs',()=>{
  assert.ok(!safeLogUrl(path).includes('device12345678'));assert.ok(!safeLogUrl(path).includes(serial));
});
