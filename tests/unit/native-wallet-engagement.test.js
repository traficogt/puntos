import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWalletEngagement} from '../../src/app/services/native-wallet/engagement.js';
const now='2026-11-11T12:00:00Z';
const branches=[{id:'a',name:'Centro',wallet_location_enabled:true,wallet_latitude:14.6,wallet_longitude:-90.5},{id:'b',name:'Norte',wallet_location_enabled:true,wallet_latitude:15,wallet_longitude:-91}];
const reward=(id,cost,extra={})=>({id,name:id,points_cost:cost,active:true,available:true,branch_ids:[],...extra});
const base={points:40,pending_points:100,program_type:'SPEND',program_json:{points_per_q:2},snapshot_at:now,wallet_branches:branches,wallet_rewards:[reward('Café',100)]};
test('progress uses only available points and preserves original reward and earning terms',()=>{
 const out=buildWalletEngagement({...base,wallet_cycle:{program_type:'VISIT',earning_terms:{points_per_visit:5}},wallet_rewards:[reward('Nuevo',200,{promise_id:'p',reward_name:'Café original',points_cost:50,branch_ids:['a'],active:false})]});
 assert.equal(out.reward.name,'Café original');assert.equal(out.reward.remaining_points,10);assert.equal(out.reward.protected,true);assert.match(out.progress,/10/);assert.match(out.earning,/5 puntos por visita/);assert.deepEqual(out.locations.map(x=>x.branch_id),['a']);
});
test('an earned choice takes precedence over a future target without claiming a reserved entitlement',()=>{
 const out=buildWalletEngagement({...base,wallet_rewards:[reward('Grande',100),reward('Pequeño',20)]});
 assert.equal(out.reward.id,'Pequeño');assert.equal(out.reward.status,'available');assert.match(out.progress,/Puedes elegir/);assert.doesNotMatch(out.progress,/ganaste|reservad/i);
});
test('unavailable, depleted, expired, inactive and branchless scoped rewards are excluded',()=>{
 const out=buildWalletEngagement({...base,wallet_rewards:[reward('no',10,{available:false}),reward('stock',10,{stock:0}),reward('old',10,{valid_until:'2026-11-10'}),reward('off',10,{active:false}),reward('foreign',10,{branch_ids:['foreign']})]});
 assert.equal(out.reward,null);assert.match(out.progress,/Consulta/);assert.equal(out.locations.length,2);
});
test('current guards exclude temporarily ineligible rewards and schedule the next useful refresh',()=>{
 const out=buildWalletEngagement({...base,program_json:{redemption_guard:{max_reward_redemptions_per_day:1,reward_cooldown_hours:24}},wallet_rewards:[reward('Café',100,{daily_count:1,last_redeemed_at:'2026-11-11T10:00:00Z'}),reward('Té',80)],wallet_next_day:'2026-11-12T06:00:00Z'});
 assert.equal(out.reward.id,'Té');assert.equal(out.next_refresh_at,'2026-11-12T06:00:00.000Z');
});
test('future expiry changes eligibility without a points mutation',()=>{
 const snapshot={...base,wallet_rewards:[reward('Café',100,{valid_until:'2026-11-11T12:30:00Z'})]};
 assert.equal(buildWalletEngagement(snapshot).next_refresh_at,'2026-11-11T12:30:00.000Z');
 assert.equal(buildWalletEngagement({...snapshot,snapshot_at:'2026-11-11T12:31:00Z'}).reward,null);
});
test('only explicit finite configured locations are emitted, deduplicated and bounded to ten',()=>{
 const list=Array.from({length:14},(_,i)=>({id:String(i),name:'Sucursal',wallet_location_enabled:true,wallet_latitude:i,wallet_longitude:i}));
 const out=buildWalletEngagement({...base,wallet_branches:[{...branches[0],wallet_latitude:null},{...branches[1],wallet_location_enabled:false},...list,list[0]]});
 assert.equal(out.locations.length,10);assert.equal(out.locations[0].latitude,0);
});
test('revocation strips progress, protected terms and locations',()=>{
 const out=buildWalletEngagement({...base,is_voided:true});assert.equal(out.reward,null);assert.equal(out.progress,null);assert.equal(out.earning,null);assert.deepEqual(out.locations,[]);assert.equal(out.next_refresh_at,null);
});
test('spend earning preserves precise rates and the protected rounding rule',()=>{
 const out=buildWalletEngagement({...base,wallet_cycle:{program_type:'SPEND',earning_terms:{points_per_q:0.00001,round:'floor',region:{country:'MX',currency:'MXN'}}}});
 assert.match(out.earning,/0,00001/);assert.match(out.earning,/MXN 1/);assert.match(out.earning,/hacia abajo/);
});
test('refund-negative available balance is included in the reward deficit',()=>{
 const out=buildWalletEngagement({...base,points:-20,pending_points:100,wallet_rewards:[reward('Café',50)]});
 assert.equal(out.reward.remaining_points,70);assert.equal(out.reward.status,'progress');assert.equal(out.progress,'Te faltan 70 puntos para Café.');
 const zeroCost=buildWalletEngagement({...base,points:-20,wallet_rewards:[reward('Detalle',0)]});
 assert.equal(zeroCost.reward.remaining_points,20);assert.equal(zeroCost.reward.status,'progress');
});

test('old protected earning terms inherit the business currency only when regional terms are absent',()=>{
 const current={points_per_q:4,region:{country:'SV',currency:'USD',timezone:'America/El_Salvador'}};
 const oldCycle={program_type:'SPEND',earning_terms:{points_per_q:0.5,round:'floor'}};
 const legacy=buildWalletEngagement({...base,program_json:current,wallet_cycle:oldCycle});
 assert.match(legacy.earning,/USD 1/);assert.match(legacy.earning,/0,5/);assert.match(legacy.earning,/hacia abajo/);
 const protectedRegion=buildWalletEngagement({...base,program_json:current,wallet_cycle:{...oldCycle,earning_terms:{...oldCycle.earning_terms,region:{country:'MX',currency:'MXN'}}}});
 assert.match(protectedRegion.earning,/MXN 1/);
});
test('reward expiry is readable in the business timezone rather than a raw UTC string',()=>{
 const expires='2026-11-12T01:30:00Z';
 const out=buildWalletEngagement({...base,program_json:{region:{country:'GT',timezone:'America/Guatemala'}},wallet_rewards:[reward('Café',100,{valid_until:expires})]});
 const local=new Intl.DateTimeFormat('es-GT',{dateStyle:'long',timeStyle:'short',timeZone:'America/Guatemala'}).format(new Date(expires));
 assert.ok(out.conditions.includes(local));assert.match(out.conditions,/America\/Guatemala/);assert.doesNotMatch(out.conditions,/2026-11-12T/);
});
test('active cards explain pending points and connection limits without claiming offline redemption',()=>{
 const out=buildWalletEngagement(base);assert.match(out.usage,/pendientes.*no se pueden canjear/);assert.match(out.usage,/mostrar.*QR sin conexión/);assert.match(out.usage,/actualizar.*conectarte/);
 assert.equal(buildWalletEngagement({...base,revoked_at:now}).usage,null);
});
