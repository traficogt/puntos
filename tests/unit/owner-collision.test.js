import {test} from 'node:test';import assert from 'node:assert/strict';
import * as collision from '../../src/app/services/campaign-collision-service.js';
test('sample evaluates configured rules, a single targeted bonus, and the hard guard without adding unsupported tier discounts',()=>{
 assert.equal(typeof collision.collisionSample,'function');
 const report=collision.collisionSample({business:{program_type:'SPEND',program_json:{points_per_q:1,campaign_rules:[{kind:'multiplier',value:2}],award_guard:{max_points_per_tx:100}}},input:{amount_q:20,visits:1,items:1},campaigns:[{id:'first',bonus_points:30,minimum_purchase_q:10},{id:'max',bonus_points:70,minimum_purchase_q:10}],now:new Date('2026-11-13T12:00:00Z')});
 assert.equal(report.program_points,40);assert.equal(report.most_generous_supported_total,70);assert.equal(report.maximum_candidate_total,110);assert.equal(report.rejected_combinations.length,1);assert.equal(report.external_discounts,'unknown');assert.equal(report.tier_awards,'not_applied_by_purchase_writer');
});
