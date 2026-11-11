import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../../src/app/services/reward-inventory-public.js').catch(()=>null);
const now=Date.parse('2026-11-11T12:00:00Z');
const business={id:'business-a',program_json:{pos_inventory_checks:true}};
const branches=[{id:'center',name:'Centro'},{id:'north',name:'Norte'}];
const reward={id:'reward-a',name:'Premio actual',reward_name:'Premio protegido',promise_id:'promise-a',points_cost:50,branch_ids:[],active:true,available:true};
function fixture({mappings=[],availability=[],evidence={}}={}){
 const calls=[];
 const client={query:async(sql,params)=>{calls.push({sql,params});if(sql.includes('FROM reward_availability'))return {rows:availability};if(sql.includes('FROM reward_pos_mappings'))return {rows:mappings};if(sql.includes('FROM branches'))return {rows:branches};throw Error('Unexpected query');}};
 const getInventory=async(_client,input)=>{calls.push({inventory:input});return evidence[input.branchId]??{state:'unknown',required:true,observedAt:null};};
 return {client,calls,getInventory};
}
test('public reads honor manual pauses without touching inventory tables before opt-in',async()=>{
 const m=await load();assert.equal(typeof m?.withPublicRewardAvailability,'function');
 const f=fixture({availability:[{reward_id:reward.id,available:false}]});
 const out=await m.withPublicRewardAvailability(f.client,{business:{...business,program_json:{}},rewards:[reward]},{getInventory:f.getInventory,now});
 assert.equal(out[0].available,false);assert.equal(Object.hasOwn(out[0],'inventory'),false);assert.equal(f.calls.length,1);assert.match(f.calls[0].sql,/reward_availability/);assert.equal(reward.available,true);
});
test('all checked branches require fresh availability, but an unchecked branch remains eligible',async()=>{
 const m=await load();assert.equal(typeof m?.withPublicRewardAvailability,'function');
 const mappings=branches.map(branch=>({reward_id:reward.id,branch_id:branch.id}));
 const f=fixture({mappings,evidence:{center:{state:'stale',required:true,observedAt:'2026-11-11T11:00:00Z'},north:{state:'unknown',required:true,observedAt:null}}});
 const out=await m.withPublicRewardAvailability(f.client,{business,rewards:[reward],branches,manualAvailabilityLoaded:true},{getInventory:f.getInventory,now});
 assert.equal(out[0].available,false);assert.equal(out[0].inventory.required,true);assert.equal(out[0].inventory.branches.length,2);
 const mixed=fixture({mappings:[mappings[0]],evidence:{center:{state:'unavailable',required:true,observedAt:'2026-11-11T11:59:00Z'}}});
 const available=await m.withPublicRewardAvailability(mixed.client,{business,rewards:[reward],branches,manualAvailabilityLoaded:true},{getInventory:mixed.getInventory,now});
 assert.equal(available[0].available,true);assert.equal(available[0].inventory.required,false);assert.equal(available[0].inventory.branches.find(b=>b.branchId==='north').state,'not_required');assert.equal(mixed.calls.filter(c=>c.inventory).length,1);
});
test('public inventory preserves protected scope and exposes no product, source or physical quantity',async()=>{
 const m=await load();assert.equal(typeof m?.withPublicRewardAvailability,'function');
 const f=fixture({mappings:branches.map(b=>({reward_id:reward.id,branch_id:b.id})),evidence:{center:{state:'available',required:true,quantity:99,source:'private-pos',productRef:'private-ref',observedAt:'2026-11-11T11:59:00Z'}}});
 const protectedReward={...reward,branch_ids:['center']};
 const out=await m.withPublicRewardAvailability(f.client,{business,rewards:[protectedReward],branches,manualAvailabilityLoaded:true},{getInventory:f.getInventory,now});
 assert.equal(out[0].available,true);assert.deepEqual(out[0].branch_ids,['center']);assert.equal(out[0].reward_name,reward.reward_name);assert.equal(out[0].points_cost,50);assert.equal(out[0].inventory.branches.length,1);assert.equal(out[0].inventory.branches[0].freshUntil,'2026-11-11T12:04:00.000Z');
 assert.doesNotMatch(JSON.stringify(out[0].inventory),/private|quantity|productRef|source/);assert.equal(f.calls.filter(c=>c.inventory)[0].inventory.businessId,business.id);
});
test('unmapped rewards and revoked Wallet snapshots preserve prior behavior without inventory queries',async()=>{
 const m=await load();assert.equal(typeof m?.withWalletRewardInventory,'function');
 const snapshot={...business,business_id:business.id,wallet_rewards:[reward],wallet_branches:branches,is_voided:true};
 const f=fixture();assert.equal(await m.withWalletRewardInventory(f.client,snapshot,{getInventory:f.getInventory,now}),snapshot);assert.equal(f.calls.length,0);
 const disabled={...snapshot,is_voided:false,program_json:{}};assert.equal(await m.withWalletRewardInventory(f.client,disabled,{getInventory:f.getInventory,now}),disabled);assert.equal(f.calls.length,0);
});
test('Wallet inventory restricts current location hints without rewriting earned terms and schedules freshness expiry',async()=>{
 const m=await load();assert.equal(typeof m?.walletInventoryEngagement,'function');
 const inventory={state:'available',required:true,branches:[{branchId:'center',branchName:'Centro',state:'available',observedAt:'2026-11-11T11:59:00Z',freshUntil:'2026-11-11T12:04:00.000Z'},{branchId:'north',branchName:'Norte',state:'stale',observedAt:'2026-11-11T11:00:00Z',freshUntil:null}]};
 const snapshot={snapshot_at:'2026-11-11T12:00:00Z',wallet_rewards:[{...reward,inventory}]};
 const engagement={reward:{id:reward.id,name:reward.reward_name,points_cost:50,branch_ids:[],protected:true},locations:branches.map(b=>({branch_id:b.id})),conditions:'Condiciones originales protegidas.',next_refresh_at:'2026-11-12T00:00:00Z'};
 const out=m.walletInventoryEngagement(snapshot,engagement);
 assert.deepEqual(out.reward.branch_ids,[]);assert.equal(out.reward.name,reward.reward_name);assert.deepEqual(out.locations.map(l=>l.branch_id),['center']);assert.match(out.conditions,/Centro/);assert.match(out.conditions,/no se reservan/i);assert.equal(out.next_refresh_at,'2026-11-11T12:04:00.001Z');assert.equal(engagement.locations.length,2);
});

test('a fresh inventory check never overrides a manual pause or an original branch restriction',async()=>{
 const m=await load();const f=fixture({mappings:[{reward_id:reward.id,branch_id:'center'}],availability:[{reward_id:reward.id,available:false}],evidence:{center:{state:'available',observedAt:'2026-11-11T11:59:00Z'}}});
 const paused=await m.withPublicRewardAvailability(f.client,{business,rewards:[reward],branches},{getInventory:f.getInventory,now});assert.equal(paused[0].available,false);assert.equal(paused[0].inventory.branches[0].state,'available');
 const outside=fixture({mappings:[{reward_id:reward.id,branch_id:'center'}]});const scoped=await m.withPublicRewardAvailability(outside.client,{business,rewards:[{...reward,branch_ids:['north']}],branches,manualAvailabilityLoaded:true},{getInventory:outside.getInventory,now});assert.equal(scoped[0].available,true);assert.equal(Object.hasOwn(scoped[0],'inventory'),false);assert.equal(outside.calls.filter(call=>call.inventory).length,0);
});
