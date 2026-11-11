import {test} from 'node:test';import assert from 'node:assert/strict';
import {basePointsPreview,launchReadiness,launchPilot} from '../src/launch-model.js';
test('base preview respects actual rounding without pretending to include campaign bonuses',()=>{
 assert.equal(basePointsPreview({program_type:'SPEND',rate:0.1,round:'ceil'},75),8);
 assert.equal(basePointsPreview({program_type:'SPEND',rate:0.1,round:'floor'},75),7);
 assert.equal(basePointsPreview({program_type:'VISIT',rate:10,round:'ceil'},2),20);
 for(const value of [-1,NaN,Infinity,''])assert.equal(basePointsPreview({program_type:'SPEND',rate:0.1,round:'ceil'},value),null);
});
test('readiness never counts unknown data or configured provider as physical proof',()=>{
 const result=launchReadiness({program:{program_type:'VISIT',rate:10,round:'ceil'},rewards:[{active:true,stock:0,points_cost:30}],operations:{sections:[{id:'messaging',state:'configured'}]}});
 assert.equal(result.program,true);assert.equal(result.activeRewards,0);assert.equal(result.physicalPassed,0);assert.equal(result.physicalTotal,0);
 assert.equal(launchReadiness({}).program,false);assert.equal(launchReadiness({}).activeRewards,null);
});
test('readiness excludes expired and unavailable rewards and accepts only reported passed checks',()=>{
 const result=launchReadiness({rewards:[{active:true,stock:null,points_cost:30},{active:true,stock:1,points_cost:20,valid_until:'2020-01-01'},{active:false,stock:1}],pilot:{checks:[{required:true,status:'passed'},{required:true,status:'failed'},{required:false,status:'not_applicable'}]}});
 assert.equal(result.activeRewards,1);assert.equal(result.physicalPassed,1);assert.equal(result.physicalTotal,2);
});

test('launch retains latest completed evidence, preferring an active pilot and never a stopped one',()=>{
 const completed={id:'old',status:'completed',closed_at:'2026-11-10T12:00:00Z'},latest={id:'latest',status:'completed',closed_at:'2026-11-11T12:00:00Z'},active={id:'active',status:'active'},stopped={id:'stopped',status:'stopped'};
 assert.equal(launchPilot([stopped,completed,latest]).id,'latest');
 assert.equal(launchPilot([latest,active]).id,'active');
 assert.equal(launchPilot([stopped]),null);
});

test('setup counts only rewards that can be offered and leaves unknown costs distinct from zero',()=>{
 const now=Date.parse('2026-11-11T12:00:00Z');
 const base={active:true,available:true,stock:null,points_cost:50};
 const rewards=[
  {...base,id:'manual',unit_cost_q:null}, {...base,id:'zero',unit_cost_q:0},
  {...base,id:'paused',available:false}, {...base,id:'empty',stock:0},
  {...base,id:'expired',valid_until:new Date(now).toISOString()},
  {...base,id:'invalid-expiry',valid_until:'not-a-date'},
  {...base,id:'invalid-points',points_cost:0}, {...base,id:'fractional-points',points_cost:1.5},
  {...base,id:'inactive',active:false}, {...base,id:'invalid-stock',stock:'unknown'},
 ];
 const result=launchReadiness({rewards},now);
 assert.equal(result.activeRewards,2);
 assert.deepEqual(result.readyRewards.map(row=>row.id),['manual','zero']);
 assert.equal(result.unknownRewardCosts,1);
 assert.equal(launchReadiness({}).unknownRewardCosts,null);
});

test('inventory-required rewards need current sufficient evidence; optional catalog never blocks setup',()=>{
 const now=Date.parse('2026-11-11T12:00:00Z');
 const base={active:true,available:true,stock:null,points_cost:50};
 const mapping={enabled:true,inventory_required:true,quantity:2,inventory:{state:'available',quantity:2,observedAt:new Date(now-60000).toISOString()}};
 const reward=(id,patch)=>({...base,id,mappings:[{...mapping,...patch}]});
 const rewards=[reward('fresh',{}),reward('stale',{inventory:{...mapping.inventory,observedAt:new Date(now-300001).toISOString()}}),reward('missing',{inventory:null}),reward('future',{inventory:{...mapping.inventory,observedAt:new Date(now+1).toISOString()}}),reward('insufficient',{inventory:{...mapping.inventory,quantity:1}}),reward('unavailable',{inventory:{...mapping.inventory,state:'unavailable'}}),reward('disabled',{enabled:false,inventory:null}),reward('optional',{inventory_required:false,inventory:null}),{...base,id:'manual'}];
 assert.deepEqual(launchReadiness({rewards},now).readyRewards.map(row=>row.id),['fresh','disabled','optional','manual']);
});

test('the next setup step follows saved prerequisites and never claims a physical test passed',async()=>{
 const {firstLaunchStep}=await import('../src/launch-model.js');
 assert.equal(typeof firstLaunchStep,'function');
 assert.equal(firstLaunchStep(launchReadiness({})),'program');
 const program={program_type:'VISIT',rate:10};
 assert.equal(firstLaunchStep(launchReadiness({program,rewards:[]})),'rewards');
 const ready=launchReadiness({program,rewards:[{active:true,available:true,stock:null,points_cost:50}]});
 assert.equal(firstLaunchStep(ready),'data');
 assert.equal(firstLaunchStep(ready,true),'launch');
 assert.equal(ready.physicalPassed,0);
});

test('setup counts a reward at an eligible branch without borrowing stock outside its protected scope', () => {
 const now=Date.parse('2026-11-11T12:00:00Z'),branches=[{id:'a',name:'Centro'},{id:'b',name:'Norte'}];
 const base={active:true,available:true,stock:null,points_cost:50,branch_ids:['a','b']};
 const mapping=(branch_id,state)=>({branch_id,enabled:true,inventory_required:true,quantity:1,inventory:{state,quantity:1,observedAt:new Date(now-1000).toISOString()}});
 const mixed={...base,id:'mixed',mappings:[mapping('a','available'),mapping('b','stale')]};
 const unchecked={...base,id:'unchecked',mappings:[mapping('a','stale')]};
 const restricted={...base,id:'restricted',branch_ids:['a'],mappings:[mapping('a','stale'),mapping('b','available')]};
 const missingBranch={...base,id:'missing',branch_ids:['foreign'],mappings:[]};
 const ready=launchReadiness({rewards:[mixed,unchecked,restricted,missingBranch],branches},now);
 assert.deepEqual(ready.readyRewards.map(row=>row.id),['mixed','unchecked']);
 assert.deepEqual(ready.readyRewards[0].ready_branch_labels,['Centro']);
 assert.deepEqual(ready.readyRewards[1].ready_branch_labels,['Norte']);
 assert.equal(ready.readyRewards[0].limited_availability,true);
});
