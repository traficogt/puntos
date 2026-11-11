import assert from 'node:assert/strict';
import {it} from 'node:test';
import {readinessForBusiness,campaignNeedsFreshActivity,promotionDelay} from '../../src/app/services/merchant-data-readiness.js';
const now=new Date('2026-11-11T18:00:00Z');
const business=(patch={})=>({program_json:{pos_integration:{enabled:true,mode:'loyverse',automatic:true,last_completed_at:now.toISOString(),last_sync:{status:'ok'},...patch}}});
it('distinguishes recorded-only manual data from a fresh complete automatic import',()=>{
 assert.equal(readinessForBusiness({},now).state,'recorded_only');
 assert.equal(readinessForBusiness(business({mode:'csv',last_completed_at:'2025-01-01T00:00:00Z'}),now).inactivity_allowed,true);
 assert.equal(readinessForBusiness(business(),now).state,'ready');
});
it('blocks activity conclusions from missing/stale/incomplete/failed automatic import evidence',()=>{
 for(const [patch,reason] of [[{last_completed_at:null},'initial_sync_incomplete'],[{last_completed_at:'2026-11-10T17:59:59Z'},'sync_stale'],[{last_sync:{has_more:true}},'sync_incomplete'],[{last_sync:{errors:1}},'sync_errors'],[{pending_receipts:['secret']},'pending_receipts'],[{enabled:false},'integration_paused'],[{last_completed_at:'2026-11-12T18:00:00Z'},'sync_time_invalid']]){
  const result=readinessForBusiness(business(patch),now);assert.equal(result.inactivity_allowed,false,String(reason));assert.equal(result.reason,reason);assert.equal(JSON.stringify(result).includes('secret'),false);
 }
});
it('does not invent a manual import deadline but blocks known incomplete manual records',()=>{
 assert.equal(readinessForBusiness(business({mode:'api',automatic:false,last_completed_at:null}),now).state,'recorded_only');
 assert.equal(readinessForBusiness(business({mode:'csv',automatic:false,last_sync:{has_more:true}}),now).inactivity_allowed,false);
});
it('detects activity-based audience filters across inclusion and exclusion',()=>{
 assert.equal(campaignNeedsFreshActivity({recovery_run_id:'id'}),true);
 for(const field of ['last_purchase_days','has_purchase','purchase_count','spend_q']) assert.equal(campaignNeedsFreshActivity({audience_snapshot:{definition:{exclude:{rules:[{field}]}}}}),true);
 assert.equal(campaignNeedsFreshActivity({audience_snapshot:{definition:{include:{rules:[{field:'points_balance'}]}}}}),false);
});
it('defers only activity promotions for stale data; birthday remains eligible',()=>{
 const b=business({last_completed_at:null});
 assert.match(promotionDelay({business:b,rule:'winback',now}).reason,/data_quality/);
 assert.equal(promotionDelay({business:b,rule:'birthday',now}),null);
 assert.equal(promotionDelay({business:b,campaign:{recovery_run_id:'r'},now}).until,'2026-11-11T19:00:00.000Z');
});
it('a temporary busy setting pauses promotions, expires automatically, and does not expose config',()=>{
 const b=business();b.program_json.merchant_operating_mode={mode:'busy',until:'2026-11-11T20:00:00Z'};
 assert.deepEqual(promotionDelay({business:b,rule:'birthday',now}),{reason:'business_busy',until:'2026-11-11T20:00:00.000Z'});
 assert.equal(promotionDelay({business:b,rule:'birthday',now:new Date('2026-11-11T20:00:00Z')}),null);
});
