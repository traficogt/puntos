import test from 'node:test';
import assert from 'node:assert/strict';
import {hospitalityCapacity, hospitalityPreset} from '../src/hospitality-pilot.js';
import {demoRewardHospitality} from '../src/demo-reward-hospitality.js';

test('whole-unit ceiling leaves an unusable budget remainder uncommitted', () => {
  assert.deepEqual(hospitalityCapacity({units:5, budget:12, unitCost:5}), {units:2, commitment:10});
  assert.deepEqual(hospitalityCapacity({units:1, budget:12, unitCost:5}), {units:1, commitment:5});
});

test('decimal cost capacity uses exact minor units at the money boundary', () => {
  assert.deepEqual(hospitalityCapacity({units:5, budget:0.3, unitCost:0.1}), {units:3, commitment:0.3});
  assert.deepEqual(hospitalityCapacity({units:5, budget:0.29, unitCost:0.1}), {units:2, commitment:0.2});
  assert.deepEqual(hospitalityCapacity({units:5, budget:4.99, unitCost:5}), {units:0, commitment:0});
});

test('a known zero cost allows bounded units without inventing an unknown cost', () => {
  assert.deepEqual(hospitalityCapacity({units:5, budget:0, unitCost:0}), {units:5, commitment:0});
  for (const unitCost of [null,undefined,'',' ',false,true,NaN,Infinity,-1,0.001]) {
    assert.equal(hospitalityCapacity({units:5, budget:25, unitCost}), null);
    assert.equal(hospitalityPreset({knownCost:unitCost, budget:25}), null);
  }
});

test('the optional preset is at most five units within the entered budget', () => {
  assert.deepEqual(hospitalityPreset({knownCost:'5.00', budget:12}), {totalUnits:2,totalCost:10,unitCostLimit:5});
  assert.deepEqual(hospitalityPreset({knownCost:4, budget:100}), {totalUnits:5,totalCost:20,unitCostLimit:4});
  assert.deepEqual(hospitalityPreset({knownCost:0, budget:0}), {totalUnits:5,totalCost:0,unitCostLimit:0});
  assert.equal(hospitalityPreset({knownCost:5, budget:4.99}), null);
});

test('invalid limits and currency fractions cannot produce a valid preview', () => {
  for (const units of [0,-1,1.5,10001,'',null]) assert.equal(hospitalityCapacity({units,budget:25,unitCost:5}),null);
  for (const budget of [-1,1000001,0.001,'',null]) assert.equal(hospitalityCapacity({units:5,budget,unitCost:5}),null);
  assert.equal(hospitalityCapacity({units:5,budget:12,unitCost:1.5,minorUnits:0}),null);
  assert.deepEqual(hospitalityPreset({knownCost:5,budget:12,minorUnits:0}),{totalUnits:2,totalCost:10,unitCostLimit:5});
});

test('the session-only demo reports all outcomes and keeps new grants unissued', () => {
  const url = new URL('https://demo.invalid/api/admin/hospitality');
  const initial = demoRewardHospitality(url), report = initial.grants[0].report;
  assert.ok(report, 'the demo includes the same owner report as the API');
  assert.equal(report.issued, report.fulfilled + report.expired_unused + report.pending);
  assert.ok(report.fulfilled > 0 && report.expired_unused > 0 && report.pending > 0);
  assert.ok(report.fulfilled_cost_unknown_units > 0);
  const body = {request_id:crypto.randomUUID(),staff_id:initial.staff[0].id,branch_id:null,reward_id:initial.rewards[0].id,title:'Prueba pequeña',total_units:2,total_cost:10,unit_cost_limit:5,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3600000).toISOString(),valid_hours:48};
  const created = demoRewardHospitality(url,{method:'POST',body:JSON.stringify(body)});
  const fresh = demoRewardHospitality(url).grants.find(g=>g.id===created.grant.id);
  assert.equal(fresh.report.issued,0);
  assert.equal(fresh.report.committed_cost,0);
  assert.equal(fresh.report.fulfilled_known_cost,null);
});
