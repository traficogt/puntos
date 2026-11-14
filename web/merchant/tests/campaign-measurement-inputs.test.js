import test from 'node:test';
import assert from 'node:assert/strict';
import { measurementPlanInput, measurementCostInput } from '../src/campaign-measurement-inputs.js';
const values = { duration_days:'14',holdout_percent:'50',measurement_plan:{baseline_return_rate_pct:30,minimum_detectable_lift_pp:10,observation_days:30,reconciliation_days:7} };
test('preview requires valid numerical assumptions and keeps unknown availability distinct from zero',()=>{
 assert.equal(measurementPlanInput(values,null).available_members,null);
 assert.equal(measurementPlanInput(values,0).available_members,0);
 for(const patch of [{baseline_return_rate_pct:''},{minimum_detectable_lift_pp:0},{observation_days:7},{reconciliation_days:31},{baseline_return_rate_pct:95,minimum_detectable_lift_pp:10}])assert.equal(measurementPlanInput({...values,measurement_plan:{...values.measurement_plan,...patch}},100),null);
});
test('cost inputs preserve explicit zero and reject invalid or negative estimates',()=>{
 assert.deepEqual(measurementCostInput({gross_margin_pct:0,fulfillment_cost_q:'',messaging_cost_q:0,other_cost_q:'',outstanding_reward_cost_q:0,notes:'  Costo confirmado  '}),{gross_margin_pct:0,fulfillment_cost_q:null,messaging_cost_q:0,other_cost_q:null,outstanding_reward_cost_q:0,notes:'Costo confirmado'});
 assert.throws(()=>measurementCostInput({notes:'x'.repeat(1001)}),/1,000/);
 for(const value of [0.001,1000000000])assert.throws(()=>measurementCostInput({messaging_cost_q:value}),/costos/);
 for(const value of [-1,Infinity,'20'])assert.throws(()=>measurementCostInput({gross_margin_pct:value}),/costo|margen/i);
});
