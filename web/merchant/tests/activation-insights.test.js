import test from 'node:test';
import assert from 'node:assert/strict';
const model=await import('../src/activity-drilldown.js').catch(()=>({}));
const demo=await import('../src/demo-activation-insights.js').catch(()=>({}));
const staffId='bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
test('summary drill-down preserves demo location and passes exact staff, branch and half-open week filters',()=>{
 assert.equal(typeof model.activityHistoryHref,'function');
 const href=model.activityHistoryHref({period:{start:'2026-11-09T06:00:00.000Z',end:'2026-11-11T18:00:00.000Z'},branch_id:'22222222-2222-4222-8222-222222222222'},{staff_id:staffId,source_group:'staff'},'https://fixture.invalid/demostracion?demo=1#resumen');
 const url=new URL(href,'https://fixture.invalid');assert.equal(url.pathname,'/demostracion');assert.equal(url.hash,'#movimientos');assert.equal(url.searchParams.get('demo'),'1');assert.equal(url.searchParams.get('staff_id'),staffId);assert.equal(url.searchParams.get('end'),'2026-11-11T18:00:00.000Z');assert.equal(url.searchParams.get('branch_id'),'22222222-2222-4222-8222-222222222222');
 assert.deepEqual(model.readActivityFilters(url.search),{staff_id:staffId,source_group:'staff',branch_id:'22222222-2222-4222-8222-222222222222',start:'2026-11-09T06:00:00.000Z',end:'2026-11-11T18:00:00.000Z'});
 assert.deepEqual(model.readActivityFilters('?staff_id=bad&source_group=fraud&business_id=other&start=bad'),{});
});
test('demo stays synthetic with missing costs and separate points and protected cycles',()=>{
 assert.equal(typeof demo.demoActivationInsights,'function');
 const exposure=demo.demoActivationInsights('reward-exposure');assert.equal(exposure.demo,true);assert.ok(exposure.issued.missing_cost>0);assert.ok(exposure.protected_choices.alternatives>exposure.protected_choices.open_cycles);assert.equal(exposure.assumptions.add_categories,false);
 const staff=demo.demoActivationInsights('staff-activity');assert.equal(staff.demo,true);assert.equal(staff.staff[0].staff_id,staffId);assert.ok(staff.sources.some(row=>row.group==='pos'));
});
