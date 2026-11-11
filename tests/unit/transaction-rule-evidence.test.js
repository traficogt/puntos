import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as points from '../../src/app/services/points-service.js';

const at = new Date('2026-11-11T18:30:00Z');
function evaluate(business, input = {}) {
  assert.equal(typeof points.computePointsWithEvidence, 'function', 'awards need an evaluator that returns the exact evidence used');
  return points.computePointsWithEvidence(business, input, { now: at, timeZone: 'America/Guatemala' });
}
it('records only the evaluated program and campaign inputs, with ordered applied and skipped rules', () => {
  const business = { program_type: 'SPEND', program_json: {
    points_per_q: 0.1, round: 'ceil', external_awards: { api_key: 'PRIVATE' },
    campaign_rules: [
      { name: 'Miércoles', kind: 'multiplier', value: 2, condition: { weekdays: [3], min_amount_q: 10 }, secret: 'PRIVATE' },
      { kind: 'bonus_points', value: 5, condition: { start_hour: 13 } },
      { kind: 'bonus_points', value: 3, max_points: 8 },
      { active: false, value: 100 }
    ]
  } };
  const result = evaluate(business, { amount_q: 21, visits: 0, items: 0 });
  assert.equal(result.points, 8);
  assert.equal(result.evidence.schema_version, 1);
  assert.equal(result.evidence.base_points, 3);
  assert.equal(result.evidence.program_points, 8);
  assert.equal(result.evidence.evaluated_at, at.toISOString());
  assert.equal(result.evidence.clock, 'server');
  assert.equal(result.evidence.local_hour, 12);
  assert.deepEqual(result.evidence.rules.map(rule => rule.outcome), ['applied', 'hours', 'applied', 'inactive']);
  assert.equal(result.evidence.rules[2].points_before, 6);
  assert.equal(result.evidence.rules[2].points_after, 8);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.match(result.evidence.rule_version, /^[a-f0-9]{64}$/);
  business.program_json.points_per_q = 99;
  assert.equal(result.evidence.program.rate, 0.1, 'snapshot is independent from later settings');
});
it('preserves award arithmetic, rounding, zero quantity defaults and campaign order', () => {
  for (const [business, input, expected] of [
    [{ program_type: 'VISIT', program_json: { points_per_visit: 2.5 } }, { visits: 0 }, 2],
    [{ program_type: 'ITEM', program_json: { points_per_item: 3 } }, { items: 2.9 }, 6],
    [{ program_json: { points_per_q: 0.1, round: 'floor' } }, { amount_q: 29 }, 2],
    [{ program_json: { points_per_q: 0.1, round: 'round' } }, { amount_q: 25 }, 3],
    [{ program_type: 'SPEND', program_json: { points_per_q: 0.1, campaign_rules: [{ kind: 'bonus_points', value: 1.7 }, { value: 2 }] } }, { amount_q: 10 }, 5]
  ]) { assert.equal(evaluate(business, input).points, expected); assert.equal(points.computePoints(business, input), expected); }
});
it('changes the rule version only for executable program content and captures failed conditions', () => {
  const business = { program_json: { points_per_q: 1, api_key: 'a', campaign_rules: [{ value: 2, condition: { min_items: 2 } }] } };
  const first = evaluate(business, { amount_q: 3 });
  business.program_json.api_key = 'b';
  assert.equal(evaluate(business, { amount_q: 4 }).evidence.rule_version, first.evidence.rule_version);
  assert.equal(first.evidence.rules[0].outcome, 'min_items');
  business.program_json.campaign_rules[0].value = 3;
  assert.notEqual(evaluate(business).evidence.rule_version, first.evidence.rule_version);
});
it('retains the legacy campaign fallback when a malformed base rate produced NaN', () => {
  assert.equal(evaluate({ program_json: { points_per_q: 'invalid', campaign_rules: [{ kind: 'bonus_points', value: 5 }] } }, { amount_q: 10 }).points, 5);
});
