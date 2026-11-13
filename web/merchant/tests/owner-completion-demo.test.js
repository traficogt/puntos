import test from 'node:test';import assert from 'node:assert/strict';
import {demoDecisions} from '../src/demo-decisions.js';
import {demoEconomics} from '../src/demo-economics.js';
import {demoGrowth} from '../src/demo-growth.js';
import {demoAudiences} from '../src/demo-audiences.js';
const call=(service,path,body)=>service(new URL(path,'https://fixture.invalid'),body?{method:'POST',body:JSON.stringify(body)}:{});
test('owner demonstration supports assigned dismissals and immutable revision history',()=>{
 const first=call(demoDecisions,'/api/admin/decisions');assert.ok(first.staff?.length);
 const item=first.decisions[0];call(demoDecisions,'/api/admin/decisions/review',{decision_key:item.key,fingerprint:item.fingerprint,version:0,status:'dismissed',assigned_staff_id:first.staff[0].id,dismiss_reason:'Seguimiento de ejemplo concluido'});
 const updated=call(demoDecisions,'/api/admin/decisions').decisions[0];assert.equal(updated.review_state,'dismissed');assert.equal(updated.assigned_staff_id,first.staff[0].id);assert.equal(call(demoDecisions,`/api/admin/decisions/history/${item.key}`).events.length,1);
});
test('operating demonstration approves fixed drafts, caps activation and quiet expires',()=>{
 const segment=call(demoAudiences,'/api/admin/audiences',{request_id:crypto.randomUUID(),name:'Demo audience',definition:{window_days:90,include:{match:'all',rules:[{field:'joined_days',operator:'gte',value:0}]},exclude:{match:'any',rules:[]}}}).segment;
 const campaign=call(demoGrowth,'/api/admin/growth-campaigns/quiet',{request_id:crypto.randomUUID(),name:'Demo quiet',audience_segment_id:segment.id,audience_segment_version:segment.version,audience_limit:5,bonus_points:10,points_budget:10,minimum_purchase_q:5,duration_minutes:60,estimated_cost_per_point_q:0.1}).campaign;
 const controls=call(demoDecisions,'/api/admin/decisions/templates');assert.ok(controls.drafts.some(c=>c.id===campaign.id));
 const approved=call(demoDecisions,'/api/admin/decisions/templates/approve',{request_id:crypto.randomUUID(),campaign_id:campaign.id,maximum_runs:1,capacity:1,expires_at:new Date(Date.now()+86400000).toISOString()}).template;
 const input={request_id:crypto.randomUUID(),template_id:approved.id,version:1},activated=call(demoDecisions,'/api/admin/decisions/templates/trigger',input);assert.equal(activated.campaign.status,'active');assert.equal(activated.operating_mode.mode,'quiet');assert.equal(call(demoDecisions,'/api/admin/decisions/templates/trigger',input).replay,true);assert.throws(()=>call(demoDecisions,'/api/admin/decisions/templates/trigger',{...input,request_id:crypto.randomUUID(),version:2}));
});
test('issued demo values remain unchanged when future retail values are entered',()=>{
 const before=call(demoEconomics,'/api/admin/reward-economics/commitments');assert.equal(before.points_separate,true);assert.ok(before.groups.length);
 demoEconomics(new URL('/api/admin/reward-economics/rewards/demo-coffee','https://fixture.invalid'),{method:'PUT',body:JSON.stringify({unit_cost_q:4,retail_value_q:15})});
 assert.deepEqual(call(demoEconomics,'/api/admin/reward-economics/commitments').groups,before.groups);assert.equal(call(demoEconomics,'/api/admin/reward-economics').rewards[0].retail_value_q,15);
});
test('collision demonstration returns editable sample, options and explicit unknowns',()=>{
 const report=call(demoGrowth,'/api/admin/growth-campaigns/demo-growth-active/collision-preview',{amount_q:100,visits:1,items:1,branch_id:null,reward_id:null,tier_id:null});assert.ok(report.options.branches.length);assert.equal(report.sample.external_discounts,'unknown');assert.equal(report.sample.inputs.amount_q,100);assert.ok(report.sample.combinations.length);assert.ok(Array.isArray(report.notes));
});
