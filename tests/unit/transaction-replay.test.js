import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluatePointRules,completeAwardEvidence} from '../../src/app/services/transaction-rule-evidence.js';
import {replaySavedAward} from '../../src/app/services/transaction-replay.js';
function award(config={}) { const evaluated=evaluatePointRules({program_type:'SPEND',program_json:{points_per_q:0.3,round:'ceil',campaign_rules:[{kind:'bonus_points',value:3,condition:{min_amount_q:10}}],...config}}, {amount_q:40,visits:1,items:2}, {now:new Date('2026-11-13T18:00:00Z'),timeZone:'America/Guatemala'}); return completeAwardEvidence(evaluated.evidence,{bonus:null,holdDays:0,status:'POSTED',availableAt:null}); }
test('historical replay recomputes saved rules without changing evidence',()=>{const e=award(),before=JSON.stringify(e),r=replaySavedAward(e,15);assert.equal(r.status,'matched');assert.equal(r.calculated_points,15);assert.equal(r.difference,0);assert.equal(JSON.stringify(e),before);});
test('replay detects an altered recorded total',()=>{assert.equal(replaySavedAward(award(),16).status,'mismatch');});
test('replay rejects changed rule content or intermediate evidence',()=>{const e=award();e.rules[0].value=30;assert.equal(replaySavedAward(e,15).status,'mismatch');const f=award();f.rules[0].points_before=0;assert.equal(replaySavedAward(f,15).status,'mismatch');});
test('legacy evidence stays unavailable instead of using current program',()=>{assert.equal(replaySavedAward(null,5).status,'unavailable');assert.equal(replaySavedAward({algorithm:'future-version'},5).status,'unavailable');});
test('zero-valued, inactive and capped rules retain historical semantics',()=>{for(const rules of [[{kind:'multiplier',value:0}], [{kind:'bonus_points',value:5,active:false}], [{kind:'multiplier',value:2,max_points:15}], [null]]) {const e=award({campaign_rules:rules});assert.equal(replaySavedAward(e,e.awarded_points).status,'matched');}});
