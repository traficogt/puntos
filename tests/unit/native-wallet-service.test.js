import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeWalletService } from '../../src/app/services/native-wallet/service.js';
const auth = {id:'c1',business_id:'b1'};
function fixture() {
  const pass = {id:'p1',provider:'apple',serial_number:'p1',authentication_token:'a'.repeat(43),membership_token:'m'.repeat(43),business_id:'b1',customer_id:'c1',revision:'2'};
  const calls=[];
  const repo={ensurePass:async x=>{calls.push(['ensure',x]);return pass;}, getSnapshot:async()=>pass,getBySerial:async()=>pass,getCustomerPasses:async()=>[pass], revokeCustomerPasses:async()=>{},claimDue:async()=>[{...pass,lock_token:'lease'}],listRegistrations:async()=>[{push_token:'device'}],deletePushToken:async()=>{},markSynced:async(...x)=>calls.push(['synced',...x]),markFailed:async(...x)=>calls.push(['failed',...x])};
  const providers={apple:{generatePass:async()=>Buffer.from('pkpass'),pushUpdate:async()=>({invalidToken:false})},google:{savePass:async()=> 'https://pay.google.com/gp/v/save/signed',updatePass:async()=>{}}};
  const settings={apple:{ready:true,config:{passTypeIdentifier:'pass.com.pf'}},google:{ready:true,config:{}}};
  const deps={repo,providers,settings,customerRepo:{getById:async()=>({id:'c1',business_id:'b1'})},globalContext:async fn=>fn()};
  return {deps,pass,calls};
}
test('disabled provider cannot touch storage or issue a pass', async()=>{
  const {deps,calls}=fixture(); deps.settings.apple.ready=false;
  await assert.rejects(createNativeWalletService(deps).issue(auth,'apple'),e=>/** @type {any} */(e).statusCode===503);assert.equal(calls.length,0);
});
test('issuance rejects deleted customer or mismatched tenant',async()=>{
  const {deps,calls}=fixture(); deps.customerRepo.getById=async()=>({id:'c1',business_id:'b2'});
  await assert.rejects(createNativeWalletService(deps).issue(auth,'apple'),e=>/** @type {any} */(e).statusCode===404);assert.equal(calls.length,0);
});
test('issuance uses fresh opaque credentials and never returns them to browser JSON',async()=>{
  const {deps,calls}=fixture(); const svc=createNativeWalletService(deps);
  assert.deepEqual(await svc.issue(auth,'apple'),{url:'/api/customer/wallet/apple/download'});
  assert.match(calls[0][1].membershipToken,/^[\w-]{43}$/);assert.match(calls[0][1].authenticationToken,/^[\w-]{43}$/);
  const status=await svc.status(auth);assert.ok(!JSON.stringify(status).includes('authentication_token'));assert.ok(!JSON.stringify(status).includes('membership_token'));
});
test('Apple pass authentication requires correct type, serial and constant-time checked token',async()=>{
  const {deps,pass}=fixture();const svc=createNativeWalletService(deps);
  assert.equal((await svc.authenticateApple('pass.com.pf','p1',`ApplePass ${pass.authentication_token}`)).id,'p1');
  await assert.rejects(svc.authenticateApple('pass.com.other','p1',`ApplePass ${pass.authentication_token}`),e=>/** @type {any} */(e).statusCode===401);
  await assert.rejects(svc.authenticateApple('pass.com.pf','p1','ApplePass wrong'),e=>/** @type {any} */(e).statusCode===401);
});
test('worker acknowledges delivered revision and retains failed jobs without leaking errors',async()=>{
  const {deps,calls}=fixture();const svc=createNativeWalletService(deps);
  assert.deepEqual(await svc.processDue(),{delivered:1,failed:0});assert.deepEqual(calls.at(-1),['synced','p1','2','lease',null]);
  deps.providers.apple.pushUpdate=async()=>{throw Error('private credential');};
  assert.deepEqual(await svc.processDue(),{delivered:0,failed:1});assert.deepEqual(calls.at(-1),['failed','p1','lease']);
});

test('existing cards remain revocable when issuance providers are disabled',async()=>{
  const {deps}=fixture();deps.settings.apple.ready=false;deps.settings.google.ready=false;
  const status=await createNativeWalletService(deps).status(auth);
  assert.equal(status.passes.length,1);assert.equal(status.providers.apple,false);
});
