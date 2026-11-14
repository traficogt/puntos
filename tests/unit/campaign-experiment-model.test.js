import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as model from '../../src/app/services/campaign-experiment-model.js';

const input = { baseline_return_rate_pct: 20, minimum_detectable_lift_pp: 6, observation_days: 30 };
const options = { durationDays: 14, holdoutPercent: 50 };
function normalize(...args) {
  assert.equal(typeof model.normalizeMeasurementPlan, 'function');
  return model.normalizeMeasurementPlan(args.length ? args[0] : input, args[1] ?? options);
}
function planning(overrides = {}) {
  assert.equal(typeof model.planCampaignExperiment, 'function');
  return model.planCampaignExperiment({ plan: normalize(), holdoutPercent: 50, availableMembers: 2000, ...overrides });
}

test('measurement plans preserve legacy absence and normalize versioned assumptions', () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize(undefined), null);
  assert.deepEqual(normalize(), { version: 1, ...input, reconciliation_days: 7 });
  assert.deepEqual(normalize({ ...input, version: 1, reconciliation_days: 0 }), { version: 1, ...input, reconciliation_days: 0 });
});

test('measurement plans reject unknown fields, coerced values and impossible windows or rates', () => {
  const invalid = [false, [], {}, { ...input, surprise: true }, { ...input, version: 2 },
    { ...input, baseline_return_rate_pct: '20' }, { ...input, baseline_return_rate_pct: 0 },
    { ...input, baseline_return_rate_pct: 96 }, { ...input, baseline_return_rate_pct: 95, minimum_detectable_lift_pp: 5 },
    { ...input, minimum_detectable_lift_pp: 0 }, { ...input, minimum_detectable_lift_pp: 51 },
    { ...input, minimum_detectable_lift_pp: Infinity }, { ...input, observation_days: 13 },
    { ...input, observation_days: 181 }, { ...input, observation_days: 30.5 },
    { ...input, reconciliation_days: -1 }, { ...input, reconciliation_days: 31 },
    { ...input, reconciliation_days: null }, { ...input, reconciliation_days: 0.5 }];
  for (const value of invalid) assert.throws(() => normalize(value), { statusCode: 400 });
  for (const holdoutPercent of [0, 100, NaN, '50']) assert.throws(() => normalize(input, { ...options, holdoutPercent }), { statusCode: 400 });
});

test('fixed-horizon planner distinguishes 1000 from 2000 available members', () => {
  const result = planning();
  assert.equal(result.method, 'two_proportion_normal_fixed_horizon');
  assert.equal(result.alpha, 0.05);
  assert.equal(result.power, 0.8);
  assert.equal(result.baseline_return_rate_pct, 20);
  assert.equal(result.minimum_detectable_lift_pp, 6);
  // Independent published formula: control=.20, treatment=.26, balanced,
  // z(.975)=1.95996398454 and z(.80)=.84162123357 => 771.0626 per arm.
  assert.equal(result.required_treatment, 772);
  assert.equal(result.required_control, 772);
  assert.equal(result.required_total, 1544);
  assert.equal(result.available_members, 2000);
  assert.equal(result.planned_treatment, 1000);
  assert.equal(result.planned_control, 1000);
  assert.equal(result.feasible, true);
  assert.equal(planning({ availableMembers: 1000 }).feasible, false);
  assert.equal(planning({ availableMembers: 1543 }).feasible, false);
  assert.equal(planning({ availableMembers: 1544 }).feasible, true);
  assert.match(result.assumptions.join(' '), /aproximaci[oó]n/i);
  assert.match(result.assumptions.join(' '), /30/);
  assert.match(result.assumptions.join(' '), /garant/i);
});

test('unbalanced allocation uses actual assignment rounding and requires more total participants', () => {
  const balanced = planning(), unbalanced = planning({ holdoutPercent: 20, availableMembers: 1001 });
  assert.equal(unbalanced.planned_control, 200);
  assert.equal(unbalanced.planned_treatment, 801);
  assert.ok(unbalanced.required_total > balanced.required_total);
  assert.equal(unbalanced.required_control, Math.max(1, Math.round(unbalanced.required_total * 0.2)));
  assert.equal(unbalanced.required_treatment + unbalanced.required_control, unbalanced.required_total);
  assert.equal(planning({ holdoutPercent: 20, availableMembers: unbalanced.required_total }).feasible, true);
  assert.equal(planning({ holdoutPercent: 20, availableMembers: unbalanced.required_total - 1 }).feasible, false);
  assert.equal(planning({ availableMembers: 61 }).planned_control, 31);
});

test('planner does not manufacture evidence for a legacy plan or unknown audience', () => {
  assert.equal(planning({ plan: null }), null);
  const unknown = planning({ availableMembers: undefined });
  assert.equal(unknown.available_members, null);
  assert.equal(unknown.planned_treatment, null);
  assert.equal(unknown.planned_control, null);
  assert.equal(unknown.feasible, null);
  const zero = planning({ availableMembers: 0 });
  assert.equal(zero.planned_treatment, 0);
  assert.equal(zero.planned_control, 0);
  assert.equal(zero.feasible, false);
  assert.equal(planning({ availableMembers: 1 }).planned_treatment, 0);
  for (const availableMembers of [-1, 10.5, Infinity, '2000']) assert.throws(() => planning({ availableMembers }), { statusCode: 400 });
});

const treatment = { members: 100, recorded_sales_q: 5000 };
const control = { members: 50, recorded_sales_q: 1500 };
const costs = { gross_margin_pct: 40, fulfillment_cost_q: 250, messaging_cost_q: 30, other_cost_q: 20, outstanding_reward_cost_q: 100 };
function contribution(overrides = {}) {
  assert.equal(typeof model.campaignContribution, 'function');
  return model.campaignContribution({ treatment, control, costs, ...overrides });
}

test('contribution compares sales per assigned member and separates incurred costs from outstanding commitments', () => {
  const out = contribution();
  assert.equal(out.sales_difference_per_member_q, 20);
  assert.equal(out.incremental_recorded_sales_q, 2000);
  assert.equal(out.incremental_gross_contribution_q, 800);
  assert.equal(out.incurred_cost_q, 300);
  assert.equal(out.estimated_incremental_contribution_q, 500);
  assert.equal(out.outstanding_reward_cost_q, 100);
  assert.equal(out.scenario_including_outstanding_q, 400);
  assert.deepEqual(out.missing_inputs, []);
  assert.equal(out.source, 'merchant_estimate');
  assert.match(out.limitations.join(' '), /utilidad contable/i);
  assert.match(out.limitations.join(' '), /causal/i);
  assert.match(out.limitations.join(' '), /puntos.*canjes|canjes.*puntos/i);
});

test('explicit zero costs are known and missing inputs never silently become zero', () => {
  const zero = contribution({ costs: { gross_margin_pct: 0, fulfillment_cost_q: 0, messaging_cost_q: 0, other_cost_q: 0, outstanding_reward_cost_q: 0 } });
  assert.equal(zero.estimated_incremental_contribution_q, 0);
  assert.equal(zero.scenario_including_outstanding_q, 0);
  assert.deepEqual(zero.missing_inputs, []);
  const unknown = contribution({ costs: null });
  assert.equal(unknown.incremental_recorded_sales_q, 2000);
  assert.equal(unknown.incremental_gross_contribution_q, null);
  assert.equal(unknown.incurred_cost_q, null);
  assert.equal(unknown.estimated_incremental_contribution_q, null);
  assert.equal(unknown.scenario_including_outstanding_q, null);
  assert.deepEqual(unknown.missing_inputs, Object.keys(costs));
  const partial = contribution({ costs: { ...costs, messaging_cost_q: null } });
  assert.equal(partial.incremental_gross_contribution_q, 800);
  assert.equal(partial.incurred_cost_q, null);
  assert.equal(partial.estimated_incremental_contribution_q, null);
  assert.deepEqual(partial.missing_inputs, ['messaging_cost_q']);
  const outstandingUnknown = contribution({ costs: { ...costs, outstanding_reward_cost_q: null } });
  assert.equal(outstandingUnknown.estimated_incremental_contribution_q, 500);
  assert.equal(outstandingUnknown.scenario_including_outstanding_q, null);
});

test('contribution retains negative observed differences without inferring reward attribution', () => {
  const negative = contribution({ treatment: { members: 100, recorded_sales_q: 2000 } });
  assert.equal(negative.incremental_recorded_sales_q, -1000);
  assert.equal(negative.estimated_incremental_contribution_q, -700);
  const rewards = contribution({ treatment: { ...treatment, points_awarded: 9999, rewards_redeemed_q: 10000 }, costs: null });
  assert.equal(rewards.incurred_cost_q, null);
  assert.equal(rewards.outstanding_reward_cost_q, null);
  assert.equal(contribution({ treatment: { members: 100, recorded_sales_q: -100 } }).incremental_recorded_sales_q, -3100);
});

test('contribution fails closed when groups cannot support a descriptive sales comparison', () => {
  for (const treatment of [{ members: 0, recorded_sales_q: 0 }, { members: 10, recorded_sales_q: null }, { members: -1, recorded_sales_q: 1 }, { members: 10, recorded_sales_q: Infinity }]) {
    const out = contribution({ treatment });
    assert.equal(out.incremental_recorded_sales_q, null);
    assert.equal(out.estimated_incremental_contribution_q, null);
    assert.equal(out.incurred_cost_q, 300);
    assert.ok(out.missing_inputs.includes('treatment_sales'));
  }
});

test('contribution rejects malformed merchant estimates instead of accepting nonfinancial values', () => {
  for (const invalid of [false, [], { ...costs, unknown_cost: 1 }, { ...costs, gross_margin_pct: 101 }, { ...costs, gross_margin_pct: -1 }, { ...costs, fulfillment_cost_q: -1 }, { ...costs, messaging_cost_q: '0' }, { ...costs, other_cost_q: Infinity }]) {
    assert.throws(() => contribution({ costs: invalid }), { statusCode: 400 });
  }
});

const measurement = {
  state: 'positive_difference', window: { complete: true }, sample_counts: { treatment: 1000, control: 1000 },
  return_difference: { estimate_pp: 8, lower_pp: 3, upper_pp: 13 },
  data_readiness: { state: 'ready' }, assignment_counts_match: true, unavailable_members: 0,
};
const diagnostics = {
  capture_state: 'complete', untrusted_time_purchases: 0, pending_refunds: 0, late_purchases: 0,
  overlap_members: 0, baseline_imbalance: false, assignment_counts_match: true, missing_preperiod_members: 0,
};
function decision(overrides = {}) {
  assert.equal(typeof model.campaignDecision, 'function');
  return model.campaignDecision({ measurement, planning: planning(), diagnostics, contribution: contribution(), followup: { state: 'complete' }, ...overrides });
}

test('decision offers cautious review only after complete evidence without declaring accounting profit', () => {
  const out = decision();
  assert.equal(out.code, 'review_repeat');
  assert.equal(out.can_recommend_repeat, false);
  assert.match(out.next_action, /prueba.*aleatori|aleatori.*prueba/i);
  assert.match(out.summary, /no demuestra.*ganancia|no.*utilidad contable/i);
  for (const key of ['title', 'summary', 'next_action']) assert.equal(typeof out[key], 'string');
});

test('data risks outrank apparently positive results and an unfinished observation window', () => {
  /** @type {Array<[object, string]>} */
  const cases = [
    [{ measurement: { ...measurement, state: 'incomplete_data' } }, 'incomplete_data'],
    [{ measurement: { ...measurement, data_readiness: { state: 'blocked', reason: 'sync_stale' } } }, 'stale_data'],
    [{ diagnostics: { ...diagnostics, assignment_counts_match: false } }, 'assignment_mismatch'],
    [{ diagnostics: { ...diagnostics, untrusted_time_purchases: 1 } }, 'untrusted_time'],
    [{ diagnostics: { ...diagnostics, capture_state: 'incomplete' } }, 'incomplete_data'],
    [{ diagnostics: { ...diagnostics, overlap_members: 1 } }, 'overlapping_campaigns'],
    [{ diagnostics: { ...diagnostics, baseline_imbalance: true } }, 'baseline_imbalance'],
    [{ diagnostics: { ...diagnostics, missing_preperiod_members: 1 } }, 'missing_preperiod'],
  ];
  for (const [overrides, code] of cases) {
    const out = decision({ followup: { state: 'waiting' }, ...overrides });
    assert.equal(out.code, code);
    assert.equal(out.can_recommend_repeat, false);
  }
  assert.match(decision({ diagnostics: { ...diagnostics, baseline_imbalance: true } }).summary, /azar/i);
});

test('unknown capture and absent diagnostics cannot establish trustworthy measurement', () => {
  assert.equal(decision({ diagnostics: { ...diagnostics, capture_state: 'unknown' } }).code, 'capture_unknown');
  assert.equal(decision({ diagnostics: {} }).code, 'capture_unknown');
  assert.equal(decision({ measurement: null }).code, 'incomplete_data');
});

test('decision waits for primary observations, longer followup and refund reconciliation', () => {
  assert.equal(decision({ measurement: { ...measurement, state: 'in_progress', window: { complete: false } } }).code, 'waiting');
  assert.equal(decision({ followup: { state: 'waiting' } }).code, 'waiting');
  assert.equal(decision({ followup: undefined }).code, 'waiting');
  assert.equal(decision({ followup: { state: 'unknown' } }).code, 'waiting');
  assert.equal(decision({ followup: { state: 'reconciling' } }).code, 'reconciling');
  assert.equal(decision({ diagnostics: { ...diagnostics, pending_refunds: 2 } }).code, 'pending_refunds');
  assert.equal(decision({ measurement: { ...measurement, state: 'interrupted' } }).code, 'interrupted');
});

test('actual assigned arms must reach the plan and 30 per arm does not demonstrate power', () => {
  assert.equal(decision({ measurement: { ...measurement, sample_counts: { treatment: 30, control: 30 } } }).code, 'insufficient_sample');
  assert.equal(decision({ measurement: { ...measurement, sample_counts: undefined } }).code, 'insufficient_sample');
  assert.equal(decision({ planning: planning({ availableMembers: 1000 }) }).code, 'insufficient_sample');
  assert.equal(decision({ planning: null }).code, 'plan_missing');
  assert.equal(decision({ measurement: { ...measurement, state: 'insufficient_sample' } }).code, 'insufficient_sample');
});

test('positive return cannot recommend repetition when costs or pending commitments remain unknown', () => {
  const unknown = contribution({ costs: { ...costs, outstanding_reward_cost_q: null } });
  assert.equal(decision({ contribution: unknown }).code, 'costs_unknown');
  assert.equal(decision({ contribution: null }).code, 'costs_unknown');
  const expensive = contribution({ costs: { ...costs, fulfillment_cost_q: 900 } });
  assert.equal(decision({ contribution: expensive }).code, 'costs_unfavorable');
  const largeOutstanding = contribution({ costs: { ...costs, outstanding_reward_cost_q: 900 } });
  assert.equal(decision({ contribution: largeOutstanding }).code, 'costs_unfavorable');
});

test('nonpositive intervals and weaker followup remain distinct from favorable findings', () => {
  const negative = { estimate_pp: -8, lower_pp: -13, upper_pp: -3 };
  assert.equal(decision({ measurement: { ...measurement, state: 'negative_difference', return_difference: negative } }).code, 'negative_difference');
  assert.equal(decision({ measurement: { ...measurement, state: 'inconclusive', return_difference: { estimate_pp: 2, lower_pp: -2, upper_pp: 6 } } }).code, 'inconclusive');
  assert.equal(decision({ followup: { state: 'complete', return_difference: negative } }).code, 'followup_weaker');
  assert.equal(decision({ measurement: { ...measurement, return_difference: null } }).code, 'incomplete_data');
});

test('draft and descriptive campaigns do not get a completed experiment verdict', () => {
  assert.equal(decision({ measurement: { ...measurement, state: 'not_started' } }).code, 'not_started');
  assert.equal(decision({ measurement: { ...measurement, state: 'descriptive' } }).code, 'descriptive');
});
