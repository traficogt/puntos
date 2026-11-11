import assert from 'node:assert/strict';
import { before, it } from 'node:test';
let demoEconomics;
const url=path=>new URL(`/api/admin/reward-economics${path}`,'https://demo.invalid');
before(async()=>{
 const module=await import('../src/demo-economics.js').catch(()=>null);
 assert.equal(typeof module?.demoEconomics,'function','isolated economics demo must exist');
 ({demoEconomics}=module);
});
it('keeps unknown history unknown and separates current balances from periods',()=>{
 const thirty=demoEconomics(url('')),ninety=demoEconomics(url('?days=90'));
 assert.equal(thirty.observed.completed_redemptions,12);assert.equal(thirty.observed.cost_coverage_pct,75);
 assert.equal(ninety.observed.completed_redemptions,28);assert.equal(thirty.observed.outstanding_points,ninety.observed.outstanding_points);
 assert.equal(thirty.estimates.margin_after_rewards_q,null);assert.equal(thirty.settings.gross_margin_pct,null);
 assert.ok(thirty.notes.some(note=>/ficticios/.test(note)));
});
it('edits a future cost including zero or clearing without rewriting demonstration history',()=>{
 const before=demoEconomics(url(''));const reward=before.rewards[0];
 for(const unit_cost_q of [8,0,null]){
  demoEconomics(url(`/rewards/${reward.id}`),{method:'PUT',body:JSON.stringify({unit_cost_q})});
  const after=demoEconomics(url(''));assert.equal(after.rewards[0].unit_cost_q,unit_cost_q);assert.deepEqual(after.observed,before.observed);
 }
 assert.equal(reward.unit_cost_q,4.5);
});
it('estimates only from supplied assumptions and blocks after-reward margin on incomplete costs',()=>{
 demoEconomics(url('/settings'),{method:'PUT',body:JSON.stringify({gross_margin_pct:40,cost_per_point_q:0.1})});
 const result=demoEconomics(url(''));assert.equal(result.estimates.gross_margin_before_rewards_q,500);assert.equal(result.estimates.outstanding_points_cost_q,840);assert.equal(result.estimates.margin_after_rewards_q,null);assert.equal(result.estimates.margin_unavailable_reason,'incomplete_reward_costs');
 demoEconomics(url('/settings'),{method:'PUT',body:JSON.stringify({gross_margin_pct:null,cost_per_point_q:null})});assert.equal(demoEconomics(url('')).estimates.gross_margin_before_rewards_q,null);
});
it('rejects unrelated routes, invalid values and extra identity fields in demo memory',()=>{
 for(const [path,body] of [['/settings',{gross_margin_pct:200,cost_per_point_q:0}],['/settings',{gross_margin_pct:40,cost_per_point_q:0,business_id:'foreign'}],['/rewards/demo-coffee',{unit_cost_q:-1}],['/rewards/missing',{unit_cost_q:5}],['/rewards/demo-coffee',{unit_cost_q:'3'}]])assert.throws(()=>demoEconomics(url(path),{method:'PUT',body:JSON.stringify(body)}));
 assert.throws(()=>demoEconomics(url('/unsupported')));
});
