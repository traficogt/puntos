import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as model from '../../src/app/services/campaign-measurement.js';
const asOf = '2026-11-11T12:00:00.000Z';
const campaign = {status:'active', offer_kind:'experiment', starts_at:'2026-10-01T00:00:00.000Z',expires_at:'2026-10-15T00:00:00.000Z'};
const treatment = {members:100,returned_customers:80,observed_members:100,unavailable_members:0};
const control = {members:100,returned_customers:40,observed_members:100,unavailable_members:0};
function evidence(overrides={}) { assert.equal(typeof model.campaignMeasurement,'function'); return model.campaignMeasurement({campaign,treatment,control,asOf,business:{},messageCounts:{accepted:12,uncertain:2},...overrides}); }
function near(a,b,epsilon=1e-7){assert.ok(Math.abs(a-b)<epsilon,`${a} ≠ ${b}`);}
test('Wilson intervals retain uncertainty for zero/all events and reject invalid denominators',()=>{
 assert.equal(typeof model.wilsonInterval,'function');
 const zero=model.wilsonInterval(0,10),all=model.wilsonInterval(10,10);
 near(zero.lower,0);near(zero.upper,0.2775328);near(all.lower,1-zero.upper);near(all.upper,1);
 const mid=model.wilsonInterval(50,100);near(mid.lower,0.40383153);near(mid.upper,0.59616847);
 for(const args of [[0,0],[11,10],[-1,10],[0.5,10],[2,Infinity],[1,'10']])assert.equal(model.wilsonInterval(...args),null);
});
test('independent-group interval is bounded, signed and symmetric when arms exchange',()=>{
 assert.equal(typeof model.returnDifference,'function');
 const result=model.returnDifference(treatment,control),reverse=model.returnDifference(control,treatment);
 near(result.estimate_pp,40);assert.ok(result.lower_pp>20 && result.upper_pp<60);
 near(result.lower_pp,-reverse.upper_pp);near(result.upper_pp,-reverse.lower_pp);
 const empty=model.returnDifference({...treatment,returned_customers:0},{...control,returned_customers:0});assert.ok(empty.lower_pp<0 && empty.upper_pp>0);
 assert.equal(model.returnDifference(treatment,{members:0,returned_customers:0}),null);
});
test('completed randomized comparison describes uncertainty, fixed denominator and provider evidence',()=>{
 const out=evidence();assert.equal(out.state,'positive_difference');assert.equal(out.window.complete,true);
 assert.equal(out.window.observed_until,campaign.expires_at);assert.equal(out.as_of,asOf);assert.equal(out.data_readiness.state,'recorded_only');
 assert.equal(out.messages.accepted,12);assert.equal(out.messages.delivered,null);assert.equal(out.messages.read,null);
 assert.equal(out.method,'newcombe_wilson_95');assert.equal(out.denominator,'all_assigned');
});
test('running, interrupted, missing or stale data cannot produce conclusive interpretation',()=>{
 assert.equal(evidence({campaign:{...campaign,expires_at:'2026-11-12T00:00:00Z'}}).state,'in_progress');
 assert.equal(evidence({campaign:{...campaign,status:'paused',paused_at:'2026-10-02T00:00:00Z'}}).state,'interrupted');
 assert.equal(evidence({control:{...control,unavailable_members:1}}).state,'incomplete_data');
 assert.equal(evidence({control:{...control,observed_members:99}}).state,'incomplete_data');
 const stale=evidence({business:{program_json:{pos_integration:{mode:'loyverse',enabled:true,automatic:true,last_completed_at:'2026-11-01T00:00:00Z'}}}});
 assert.equal(stale.state,'incomplete_data');assert.equal(stale.data_readiness.reason,'sync_stale');
});
test('small samples, zero events and equal arms do not manufacture a winner',()=>{
 assert.equal(evidence({control:{members:20,returned_customers:0,observed_members:20,unavailable_members:0}}).state,'insufficient_sample');
 assert.equal(evidence({control:treatment}).state,'inconclusive');
 assert.equal(evidence({treatment:control,control:treatment}).state,'negative_difference');
});
test('draft and quiet offers do not receive randomized causal comparison',()=>{
 assert.equal(evidence({campaign:{...campaign,status:'draft',starts_at:null,expires_at:null}}).state,'not_started');
 const quiet=evidence({campaign:{...campaign,offer_kind:'quiet'},control:{members:0,returned_customers:0,observed_members:0,unavailable_members:0}});
 assert.equal(quiet.state,'descriptive');assert.equal(quiet.return_difference,null);assert.equal(quiet.method,null);
});
test('invalid windows and impossible counts fail closed',()=>{
 assert.equal(evidence({asOf:'invalid'}).state,'incomplete_data');
 assert.equal(evidence({campaign:{...campaign,expires_at:'2026-09-01T00:00:00Z'}}).state,'incomplete_data');
 assert.equal(evidence({treatment:{...treatment,returned_customers:101}}).state,'incomplete_data');
});

test('unequal assigned groups match the fixed Newcombe example',()=>{
 const out=model.returnDifference({members:80,returned_customers:24},{members:20,returned_customers:4});
 near(out.estimate_pp,10);near(out.lower_pp,-13.37685,0.00001);near(out.upper_pp,26.07417,0.00001);
});
