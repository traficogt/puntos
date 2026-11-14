import test from 'node:test';
import assert from 'node:assert/strict';
import { demoGrowth } from '../src/demo-growth.js';
import { demoAudiences } from '../src/demo-audiences.js';
const call=(suffix='',body)=>demoGrowth(new URL(`https://demo.invalid/api/admin/growth-campaigns${suffix}`),body?{method:'POST',body:JSON.stringify(body)}:{});
const plan={baseline_return_rate_pct:30,minimum_detectable_lift_pp:10,observation_days:30,reconciliation_days:7};
test('demo plans honestly warn when the audience is below the sample requirement',()=>{
 const {planning}=call('/measurement-plan',{measurement_plan:plan,duration_days:14,holdout_percent:50,available_members:100});
 assert.ok(planning.required_total>100);assert.equal(planning.available_members,100);assert.equal(planning.feasible,false);
 assert.throws(()=>call('/measurement-plan',{measurement_plan:{...plan,observation_days:7},duration_days:14,holdout_percent:50,available_members:100}));
});
test('demo keeps legacy plans absent and provides follow-up diagnostics without a false winner',()=>{
 const legacy=call('/demo-growth-active');assert.equal(legacy.campaign.measurement_plan,null);
 const fixture=call().campaigns.find(c=>c.id==='demo-growth-reconciling');assert.ok(fixture);
 const {results:r}=call(`/${fixture.id}`);assert.equal(r.followup.state,'reconciling');assert.equal(r.decision.can_recommend_repeat,false);assert.ok(r.diagnostics.late_purchases>0);
 assert.equal(r.measurement.window.time_basis,'purchase_occurred_at_with_recorded_fallback');
});
test('demo saves idempotent costs and immutable report revisions; GET does not create revisions',()=>{
 const id='demo-growth-reconciling',url=`/${id}`;
 assert.equal(call(url).results.report_revision.latest,null);
 const input={request_id:crypto.randomUUID(),gross_margin_pct:60,fulfillment_cost_q:0,messaging_cost_q:12,other_cost_q:0,outstanding_reward_cost_q:0,notes:'Estimación del negocio'};
 call(`${url}/measurement-costs`,input);const request={request_id:crypto.randomUUID()};
 const first=call(`${url}/measurement-reports`,request),replay=call(`${url}/measurement-reports`,request);assert.equal(first.revision,replay.revision);
 assert.equal(call(url).results.report_revision.changed,false);
 call(`${url}/measurement-costs`,{...input,request_id:crypto.randomUUID(),messaging_cost_q:20});
 assert.equal(call(url).results.report_revision.changed,true);
 const history=call(`${url}/measurement-reports`);assert.equal(history.reports.length,1);assert.equal(history.reports[0].revision,first.revision);assert.equal(history.reports[0].contribution.incurred_cost_q,12);
 history.reports[0].contribution.incurred_cost_q=999;assert.equal(call(`${url}/measurement-reports`).reports[0].contribution.incurred_cost_q,12);
 assert.throws(()=>call(`${url}/measurement-costs`,{...input,messaging_cost_q:999}),/solicitud|datos/i);
});

test('standard and background creation preserve the plan, while quiet offers have no plan',()=>{
 const values={request_id:crypto.randomUUID(),name:'Plan guardado',recovery_run_id:'demo-recovery-growth',duration_days:14,holdout_percent:50,bonus_points:50,minimum_purchase_q:10,measurement_plan:plan};
 const standard=call('',values).campaign;assert.deepEqual(standard.measurement_plan,{version:1,...plan});assert.equal(standard.holdout_percent,50);
 const {segment}=demoAudiences(new URL('https://demo.invalid/api/admin/audiences'),{method:'POST',body:JSON.stringify({name:'Audiencia de prueba',request_id:crypto.randomUUID(),definition:{window_days:90,include:{match:'all',rules:[{field:'joined_days',operator:'gte',value:0}]},exclude:{match:'any',rules:[]}}})});
 const {recovery_run_id,...audienceValues}=values;const audience={...audienceValues,request_id:crypto.randomUUID(),audience_segment_id:segment.id,audience_segment_version:segment.version,audience_limit:5000};
 const prepared=call('/prepare',audience).campaign;assert.deepEqual(prepared.measurement_plan,{version:1,...plan});
 const quiet=call('/quiet',{...audience,request_id:crypto.randomUUID(),duration_minutes:60,points_budget:1000,audience_limit:20}).campaign;assert.equal(quiet.measurement_plan,null);
});
test('demo does not invent a follow-up window when observation equals the offer',()=>{
 const {campaign}=call('',{request_id:crypto.randomUUID(),name:'Sin ventana posterior',recovery_run_id:'demo-recovery-growth',duration_days:14,holdout_percent:50,bonus_points:50,minimum_purchase_q:10,measurement_plan:{...plan,observation_days:14}});
 call(`/${campaign.id}/activate`,{});
 const {results}=call(`/${campaign.id}`);assert.equal(results.followup.available,false);assert.equal(results.followup.starts_at,results.followup.ends_at);assert.equal(results.followup.return_difference,null);
 assert.equal(call('/demo-growth-active').results.followup.available,false);
});
