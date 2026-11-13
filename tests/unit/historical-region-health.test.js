import assert from 'node:assert/strict';
import {test} from 'node:test';
import {computePointsWithEvidence} from '../../src/app/services/points-service.js';
import {completeAwardEvidence} from '../../src/app/services/transaction-rule-evidence.js';
import {awardSchema} from '../../src/app/services/transaction-evidence-schema.js';
import {replaySavedAward} from '../../src/app/services/transaction-replay.js';
import {getPlatformOperationsHealth} from '../../src/app/services/platform-health-service.js';

test('new award evidence preserves its issue currency and timezone after regional settings change',()=>{
 const business={program_json:{points_per_q:1,region:{country:'GT',currency:'GTQ',timezone:'America/Guatemala'}}};
 const result=computePointsWithEvidence(business,{amount_q:20,visits:1,items:1},{now:new Date('2026-11-13T18:00:00Z')});
 const saved=completeAwardEvidence(result.evidence,{bonus:null,holdDays:0,status:'POSTED',availableAt:null});
 business.program_json.region={country:'PA',currency:'USD',timezone:'America/Panama'};
 const parsed=awardSchema.parse(saved);
 assert.equal(parsed.currency,'GTQ');assert.equal(parsed.time_zone,'America/Guatemala');
 assert.equal(replaySavedAward(parsed,20).status,'matched');
 const current=computePointsWithEvidence(business,{amount_q:20},{now:new Date('2026-11-13T18:00:00Z')});
 assert.equal(current.evidence.currency,'USD');
});
test('legacy evidence remains replayable with unknown historical currency',()=>{
 const result=computePointsWithEvidence({program_json:{points_per_q:1}},{amount_q:20},{now:new Date('2026-11-13T18:00:00Z')});
 const saved=completeAwardEvidence(result.evidence,{bonus:null,holdDays:0,status:'POSTED',availableAt:null});
 delete saved.currency;
 const parsed=awardSchema.parse(saved);assert.equal(parsed.currency,undefined);assert.equal(replaySavedAward(parsed,20).status,'matched');
 assert.equal(awardSchema.safeParse({...saved,currency:'NOT_A_CURRENCY'}).success,false);
});
test('platform health associates monitored branches only with each merchant scoped name map',async()=>{
 const now=new Date('2026-11-13T18:00:00Z');
 const rows=['business-a','business-b'].map((id,index)=>({id,name:id,slug:id,branch_names:{'branch-shared':index?'Norte':'Centro'},program_json:{data_health:{sources:[{id:'monitor',source:'pos',label:'Caja',branch_id:'branch-shared',expected_minutes:60,enabled:true},{id:'missing',source:'other',label:'Caja',branch_id:'removed-branch',expected_minutes:60,enabled:true}]}},members:0,recorded_redemptions:0,open_cases:0}));
 let sql='';const report=await getPlatformOperationsHealth({},{isPlatformAdmin:()=>true,now:()=>now,query:async statement=>{sql=statement;return {rows};}});
 assert.match(sql,/branches\s+\w+\s+WHERE\s+\w+\.business_id\s*=\s*b\.id/i);
 assert.equal(report.businesses[0].readiness.sources[0].branch_name,'Centro');
 assert.equal(report.businesses[1].readiness.sources[0].branch_name,'Norte');
 assert.equal(report.businesses[0].readiness.sources[1].branch_name,null);
 assert.equal(report.businesses[0].readiness.sources[1].branch_id,'removed-branch');
});
