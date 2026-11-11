import test from 'node:test';
import assert from 'node:assert/strict';
import {runWithDbContext} from '../../src/app/database.js';
import {customerRoutes} from '../../src/app/routes/customer-routes.js';
import {CustomerRepo} from '../../src/app/repositories/customer-repository.js';
import {RewardRepo} from '../../src/app/repositories/reward-repository.js';
import {NativeWalletRepo} from '../../src/app/repositories/native-wallet-repository.js';
const businessId='business-inventory',customerId='customer-inventory';
const rewards=[{id:'r1',name:'Café actual',reward_name:'Café original',promise_id:'p1',points_cost:20,active:true,stock:null,available:true,branch_ids:[]},{id:'r2',name:'Té',points_cost:100,active:true,stock:null,available:true,branch_ids:[]}];
const branches=[{id:'center',name:'Centro',wallet_location_enabled:true,wallet_latitude:14,wallet_longitude:-90},{id:'north',name:'Norte',wallet_location_enabled:true,wallet_latitude:15,wallet_longitude:-91}];
function clientFixture({enabled=true,quantity=null,manualPaused=false}={}){
 const calls=[],now=new Date(),snapshot={id:'pass',business_id:businessId,customer_id:customerId,membership_token:'fixture-token',authentication_token:'fixture-auth',program_json:{pos_inventory_checks:enabled,points_per_visit:10},program_type:'VISIT',snapshot_at:now.toISOString(),points:50,wallet_rewards:structuredClone(rewards),wallet_branches:branches,revision:'1'};
 const client={query:async(sql,params)=>{
  calls.push({sql,params});
  if(sql.includes('WITH snapshot AS ('))return {rows:[snapshot]};
  if(sql.includes('FROM reward_availability'))return {rows:manualPaused?[{reward_id:'r1',available:false}]:[]};
  if(sql.includes('SELECT reward_id,branch_id FROM reward_pos_mappings'))return {rows:[{reward_id:'r1',branch_id:'center'},{reward_id:'r1',branch_id:'north'}]};
  if(sql.includes('FROM branches'))return {rows:branches};
  if(sql.includes('SELECT m.source,m.product_ref'))return {rows:[{source:'private-source',product_ref:'private-ref',quantity:1,item_kind:'product',origin:'connector',active:true,available_quantity:params[2]==='center'?quantity:4,observed_at:new Date(now.getTime()-(params[2]==='center'?60000:600000)),checked_at:now}]};
  throw Error('Unexpected query');
 }};
 return {client,calls,snapshot};
}
test('customer rewards route applies live availability and bypasses inventory reads before business opt-in',async t=>{
 t.mock.method(CustomerRepo,'getById',async()=>({id:customerId,business_id:businessId}));t.mock.method(RewardRepo,'listByBusiness',async()=>structuredClone(rewards));
 const handler=/** @type {any} */(customerRoutes.stack.find(layer=>layer.route?.path==='/customer/rewards').route.stack.at(-1).handle);
 for(const enabled of [false,true]){
  const f=clientFixture({enabled,quantity:0,manualPaused:!enabled}),req={customerAuth:{id:customerId,business_id:businessId},_resolvedBusiness:{id:businessId,program_json:{pos_inventory_checks:enabled}}};
  /** @type {any} */ let body;let failure;const headers={};
  await runWithDbContext({client:f.client,tenantId:businessId},()=>handler(req,{setHeader:(name,value)=>headers[name]=value,json:value=>{body=value;}},error=>{failure=error;}));
  assert.equal(failure,undefined);assert.equal(body.rewards[0].available,false);assert.equal(body.rewards[1].available,true);assert.equal(headers['Cache-Control'],'no-store');
  assert.equal(body.progress.available_points,50);assert.equal(body.progress.choices[0].name,'Café original');assert.equal(body.progress.choices[0].points_cost,20);
  assert.doesNotMatch(JSON.stringify(body.progress),/fixture-token|fixture-auth|membership_token|authentication_token/);
  assert.equal(f.calls.some(call=>call.sql.includes('reward_pos_mappings')),enabled);assert.equal(Boolean(body.rewards[0].inventory),enabled);assert.doesNotMatch(JSON.stringify(body),/private-source|private-ref|available_quantity/);
 }
});
test('Wallet repository skips unchecked schema and chooses only presently eligible rewards after augmentation',async()=>{
 const old=clientFixture({enabled:false});const oldSnapshot=await runWithDbContext({client:old.client,tenantId:businessId},()=>NativeWalletRepo.getSnapshot('pass'));assert.equal(old.calls.length,1);assert.equal(oldSnapshot.wallet_engagement.reward.name,'Café original');
 const unknown=clientFixture();const blocked=await runWithDbContext({client:unknown.client,tenantId:businessId},()=>NativeWalletRepo.getSnapshot('pass'));assert.equal(blocked.wallet_engagement.reward.id,'r2');assert.equal(blocked.wallet_rewards[0].reward_name,'Café original');assert.deepEqual(blocked.wallet_rewards[0].branch_ids,[]);
 const fresh=clientFixture({quantity:3});fresh.snapshot.wallet_rewards[0].active=false;const out=await runWithDbContext({client:fresh.client,tenantId:businessId},()=>NativeWalletRepo.getSnapshot('pass'));assert.equal(out.wallet_engagement.reward.name,'Café original');assert.deepEqual(out.wallet_engagement.reward.branch_ids,[]);assert.deepEqual(out.wallet_engagement.locations.map(branch=>branch.branch_id),['center']);assert.ok(Date.parse(out.next_refresh_at)>Date.parse(out.snapshot_at));assert.ok(Date.parse(out.next_refresh_at)-Date.parse(out.snapshot_at)<=300001);assert.equal(out.wallet_rewards[0].stock,null);
});
