// Synthetic, browser-only illustration. No customer data or provider calls.
export function demoActivationInsights(kind, branchId = null) {
  const region = { country: 'GT', currency: 'GTQ', locale: 'es-GT', timezone: 'America/Guatemala', minorUnits: 2 };
  const base = { ok: true, demo: true, region, currency: 'GTQ', timezone: region.timezone, generated_at: '2026-11-11T18:30:00.000Z', branch_id: branchId };
  if (kind === 'reward-exposure') return { ...base,
    issued: { outstanding: 3, costed: 2, missing_cost: 1, known_estimated_cost_q: 10, cost_coverage_pct: 66.67, approved_at_issue_cost_q: 12 },
    protected_choices: { open_cycles: 4, alternatives: 8, cycles_missing_cost: 2, scope: 'business' },
    points: { outstanding: 1200, pending: 80, negative: -10, scope: 'business', cost_per_point_q: 0.05, scenario_cost_q: 60 },
    completed: { count: 8, costed: 6, missing_cost: 2, known_snapshot_cost_q: 30, period: { start: '2026-10-13T06:00:00.000Z', end: base.generated_at, days: 30 } },
    assumptions: { issued_cost: 'current_merchant_unit_cost', approved_cost: 'recorded_at_issue', completed_cost: 'recorded_at_completion', add_categories: false }
  };
  const staff = { staff_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'María · ejemplo', active: true, movements: branchId ? 3 : 4, purchases: 2, recorded_purchase_amount_q: 150, awards: 2, points_awarded: 30, adjustments: branchId ? 0 : 1, adjustment_points: branchId ? 0 : 4, adjustment_pending_points: branchId ? 0 : -2, reversals: 1, reversal_points: -12 };
  const pos = { group: 'pos', movements: 1, purchases: 1, recorded_purchase_amount_q: 40, awards: 1, points_awarded: 8, adjustments: 0, adjustment_points: 0, adjustment_pending_points: 0, reversals: 0, reversal_points: 0 };
  const totals = Object.fromEntries(['movements','purchases','recorded_purchase_amount_q','awards','points_awarded','adjustments','adjustment_points','adjustment_pending_points','reversals','reversal_points'].map(key => [key, staff[key] + pos[key]]));
  return { ...base, period: { start: '2026-11-09T06:00:00.000Z', end: base.generated_at, partial: true }, totals, staff: [staff], staff_total: 1, staff_limit: 20, sources: [pos], adjustments_scope: branchId ? 'excluded_no_recorded_branch' : 'business', interpretation: 'recorded_activity_not_performance_or_fraud' };
}
