import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const customerId='11111111-1111-4111-8111-111111111111', businessId='22222222-2222-4222-8222-222222222222';
const auth={id:customerId,business_id:businessId};
const body={installationId:'33333333-3333-4333-8333-333333333333',installationSecret:randomBytes(32).toString('base64url'),token:'ab'.repeat(32),platform:'ios'};
async function fixture(patch={}) {
  const {createMobilePushService}=await import('../../src/app/services/mobile-push/service.js');
  const state={sent:[],acks:[],failures:[],register:[],revoke:[],released:[],snapshots:0,progress:{choices:[]},progressReads:[],overrides:{},claims:[],snapshot:{installation_id:body.installationId,customer_id:customerId,business_id:businessId,token:body.token,topic:'com.puntosfieles.customer',points:30,pending_points:0,baseline_points:10,baseline_pending:0,revision:'2',plan:'NEGOCIO'}};
  const repo={
    register:async data=>{state.register.push(data);return {enabled:true,expiresAt:'2026-12-10T00:00:00.000Z'};},
    revoke:async (...data)=>{state.revoke.push(data);return {ok:true};},
    claimDue:async ()=>state.claims,
    getSnapshot:async ()=>{state.snapshots++;return state.snapshot;},
    acknowledge:async (...data)=>{state.acks.push(data);},
    fail:async (...data)=>{state.failures.push(data);},
    claimTest:async ()=>state.claims[0]||null,
    releaseTest:async claim=>{state.released.push(claim);},
    ...patch.repo
  };
  const provider={send:async input=>{state.sent.push(input);return {accepted:true};},...patch.provider};
  const service=createMobilePushService({repo,provider,settings:{ready:true,config:{topic:'com.puntosfieles.customer'},...patch.settings},
    getRewardProgress:async ids=>{assert.deepEqual(ids,{businessId,customerId});state.progressReads.push(ids);if(patch.progressError)throw Error('Progress unavailable');return state.progress;},
    planConfigService:{getPlanFeatureOverrides:async()=>state.overrides},globalContext:async fn=>fn()});
  return {service,state};
}

test('registration validates strict credentials and binds server identity, session and topic',async()=>{
  const {service,state}=await fixture();
  assert.deepEqual(service.status(),{available:true});
  assert.equal((await service.register(auth,{id:'session'},body)).enabled,true);
  assert.equal(state.register[0].businessId,businessId);assert.equal(state.register[0].customerId,customerId);
  assert.equal(state.register[0].sessionId,'session');assert.equal(state.register[0].topic,'com.puntosfieles.customer');
  for(const patch of [{platform:'android'},{token:'xx'},{token:'a'.repeat(63)},{installationId:'other'},{installationSecret:'a'.repeat(42)},{installationSecret:'a'.repeat(43)},{businessId},{environment:'sandbox'},{topic:'other'}]) {
    await assert.rejects(service.register(auth,{id:'session'},{...body,...patch}),{statusCode:400});
  }
  const disabled=await fixture({settings:{ready:false}});
  assert.deepEqual(disabled.service.status(),{available:false});
  await assert.rejects(disabled.service.register(auth,{id:'session'},body),{statusCode:503});
  assert.deepEqual(await disabled.service.processDue(),{sent:0,failed:0,skipped:0});
});

test('credential-only revoke remains available with no provider and rejects extra capabilities',async()=>{
  const {service,state}=await fixture({settings:{ready:false}});
  const credentials={installationId:body.installationId,installationSecret:body.installationSecret};
  assert.deepEqual(await service.revoke(credentials),{ok:true});
  assert.deepEqual(state.revoke[0],[body.installationId,body.installationSecret]);
  await assert.rejects(service.revoke({...credentials,customerId}),{statusCode:400});
});

test('generic alert routes to newly affordable eligible rewards only',async()=>{
  for(const kind of ['card','rewards']) {
    const {service,state}=await fixture();state.claims=[{installation_id:body.installationId,generation:'1',lock_token:'lease'}];
    state.progress.choices=[{active:true,available:true,points_cost:20}];
    if(kind==='card') state.overrides={NEGOCIO:{rewards:false}};
    assert.deepEqual(await service.processDue(),{sent:1,failed:0,skipped:0});
    assert.equal(state.snapshots,2,'consent/generation rechecked just before delivery');
    const payload=state.sent[0].payload;
    assert.equal(payload.kind,kind);assert.equal(payload.customerId,customerId);assert.equal(payload.businessId,businessId);
    assert.deepEqual(Object.keys(payload).sort(),['aps','businessId','customerId','kind']);
    assert.deepEqual(Object.keys(payload.aps).sort(),['alert','sound']);
    assert.equal(JSON.stringify(payload).includes(body.token),false);
    assert.equal(state.acks.length,1);
  }
});

test('ineligible, inactive, already affordable and unaffordable progress choices are excluded',async()=>{
  const {service,state}=await fixture();state.claims=[{installation_id:body.installationId}];
  state.progress.choices=[{active:false,available:true,points_cost:20},{active:true,available:false,points_cost:20},{active:true,available:true,points_cost:10},{active:true,available:true,points_cost:31}];
  await service.processDue();assert.equal(state.sent[0].payload.kind,'card');
});

test('unchanged net balance is acknowledged silently; pending change alerts; revoked or rebound claim never sends',async()=>{
  const {service,state}=await fixture();state.claims=[{installation_id:body.installationId}];
  state.snapshot.points=10;
  await service.processDue();assert.equal(state.sent.length,0);assert.equal(state.acks.length,1);
  state.snapshot.pending_points=2;
  await service.processDue();assert.equal(state.sent[0].payload.kind,'card');
  const revoked=await fixture({repo:{getSnapshot:async()=>null}});revoked.state.claims=state.claims;
  await revoked.service.processDue();assert.equal(revoked.state.sent.length,0);
  let reads=0;
  const racing=await fixture({repo:{getSnapshot:async()=>++reads===1?state.snapshot:null}});racing.state.claims=state.claims;
  await racing.service.processDue();assert.equal(racing.state.sent.length,0);
});

test('provider failures are persisted without acknowledging balances, and test reports sent only on acceptance',async()=>{
  for(const outcome of [{accepted:false,invalidToken:true,retryable:false},{accepted:false,invalidToken:false,retryable:false},{accepted:false,invalidToken:false,retryable:true}]) {
    const {service,state}=await fixture({provider:{send:async()=>outcome}});state.claims=[{installation_id:body.installationId}];
    assert.equal((await service.processDue()).failed,1);assert.equal(state.acks.length,0);
    assert.deepEqual(state.failures[0][1],outcome);
    await assert.rejects(service.test(auth,{installationId:body.installationId,installationSecret:body.installationSecret}),{statusCode:503});
  }
  const {service,state}=await fixture();
  await assert.rejects(service.test(auth,{installationId:body.installationId,installationSecret:body.installationSecret}),{statusCode:409});
  state.claims=[{installation_id:body.installationId}];
  assert.deepEqual(await service.test(auth,{installationId:body.installationId,installationSecret:body.installationSecret}),{sent:true});
  assert.equal(state.acks.length,0);assert.equal(state.released.length,1);
});


test('manual unavailability, stale required inventory and redemption guards cannot announce an unlocked reward',async()=>{
  for(const reason of ['manual','stale','guard']) {
    const {service,state}=await fixture();state.claims=[{installation_id:body.installationId}];
    state.progress.choices=[{id:reason,active:true,available:false,points_cost:20,stock:4,valid_until:null}];
    assert.deepEqual(await service.processDue(),{sent:1,failed:0,skipped:0});
    assert.equal(state.sent[0].payload.kind,'card');
    assert.equal(state.progressReads.length,1);
  }
});

test('push affordability uses the authoritative protected points',async()=>{
  for(const [protectedCost,expected] of [[50,'card'],[20,'rewards'],[5,'card']]) {
    const {service,state}=await fixture();state.claims=[{installation_id:body.installationId}];
    state.progress.choices=[{active:true,available:true,protected:true,points_cost:protectedCost}];
    await service.processDue();assert.equal(state.sent[0].payload.kind,expected);
  }
});

test('progress errors retain the retry path without sending or acknowledging',async()=>{
  const {service,state}=await fixture({progressError:true});state.claims=[{installation_id:body.installationId}];
  assert.deepEqual(await service.processDue(),{sent:0,failed:1,skipped:0});
  assert.equal(state.sent.length,0);assert.equal(state.acks.length,0);
  assert.deepEqual(state.failures,[[state.claims[0],{retryable:true}]]);
});

test('missing customer progress cannot announce a reward',async()=>{
  const {service,state}=await fixture();state.claims=[{installation_id:body.installationId}];
  state.progress=null;
  await service.processDue();assert.equal(state.sent[0].payload.kind,'card');
});
