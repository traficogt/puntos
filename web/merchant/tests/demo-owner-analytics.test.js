import test from "node:test";
import assert from "node:assert/strict";
import { demoApi } from "../src/demo-api.js";
import { createOwnerAnalyticsDemoApi } from "../src/demo-owner-analytics.ts";

const branchId = "22222222-2222-4222-8222-222222222222";

test("the analytics suite has preview data for every view and never reaches fetch", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Unexpected network");
  };
  try {
    const plan = await demoApi("/api/admin/plan");
    assert.equal(plan.features.analytics, true);
    assert.equal(plan.features.rewards, true);
    const dashboard = await demoApi("/api/admin/analytics/dashboard");
    assert.equal(dashboard.recent_activity.length, 30);
    assert.equal(dashboard.rfm_distribution.length, 4);
    assert.equal(dashboard.branch_performance[0].branch_id, branchId, "the one demo branch is the one /api/admin/branches lists");
    assert.ok(Number(dashboard.summary.total_customers) > Number(dashboard.summary.high_churn_risk_count));
    const overview = await demoApi("/api/admin/analytics/overview?days=30");
    const trendTotal = dashboard.recent_activity.reduce((sum, row) => sum + Number(row.revenue), 0);
    assert.equal(trendTotal, overview.current.recorded_sales_q, "the analytics trend and the Overview preview agree on 30-day sales");
    const branch = await demoApi(`/api/admin/analytics/dashboard?branch_id=${branchId}`);
    assert.ok(Number(branch.summary.total_customers) < Number(dashboard.summary.total_customers));
    assert.equal(branch.branch_id, branchId);
    await assert.rejects(demoApi("/api/admin/analytics/dashboard?branch_id=otra"), /branch_id/);
    const churn = await demoApi("/api/admin/analytics/churn-risk?limit=10");
    assert.equal(churn.customers.length, 9);
    assert.equal(churn.count, 9);
    assert.ok(churn.customers.every((row) => Number(row.churn_risk_score) >= 0.7));
    assert.equal((await demoApi("/api/admin/analytics/churn-risk?limit=3")).customers.length, 3);
    const cohorts = await demoApi("/api/admin/analytics/cohorts?months=12");
    assert.equal(cohorts.cohorts.length, 6 * 13, "six monthly cohorts with month offsets 0..12, like the server");
    assert.equal(cohorts.cohorts[0].month_number, 0);
    assert.equal(Number(cohorts.cohorts[0].retention_rate), 100);
    const roi = await demoApi("/api/admin/roi?days=30");
    assert.equal(roi.days, 30);
    assert.equal(roi.roi.revenue_current_q, overview.current.recorded_sales_q, "the comparison window matches the Overview's 30-day sales");
    assert.ok(roi.roi.revenue_growth_pct > 0);
    assert.equal(roi.roi.customers_active, plan.usage.active_customers, "active customers agree with the plan usage card");
    assert.ok((await demoApi("/api/admin/roi?days=90")).roi.revenue_current_q > roi.roi.revenue_current_q);
    assert.equal((await demoApi("/api/admin/roi?days=5")).days, 7, "the server clamps days to 7..120");
    // The Overview preview keeps its own branch handling: an unknown branch there still answers.
    assert.ok((await demoApi("/api/admin/analytics/overview?days=7&branch_id=demo")).current.purchases > 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("the reward redemption ledger lists recent redemptions, flags the inconsistent one and opens its detail", async () => {
  const rewards = (await demoApi("/api/admin/rewards")).rewards;
  const coffee = await demoApi(`/api/admin/analytics/rewards/${rewards[0].id}/redemptions`);
  assert.equal(coffee.reward.name, rewards[0].name);
  assert.equal(coffee.summary.recent_redemption_count, 5);
  assert.equal(coffee.summary.mismatch_count, 1);
  const dates = coffee.recent_redemptions.map((row) => row.created_at);
  assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");
  const broken = coffee.recent_redemptions.find((row) => Number(row.linked_transaction_count) === 0);
  const fine = coffee.recent_redemptions.find((row) => Number(row.linked_transaction_count) === 1);
  const detail = await demoApi(`/api/admin/analytics/redemptions/${fine.id}`);
  assert.equal(detail.ledger.consistent, true);
  assert.equal(detail.ledger.linked_points_total, -Number(fine.points_cost));
  assert.equal(detail.transactions.length, 1);
  assert.equal(detail.transactions[0].meta.redemption_id, fine.id);
  const brokenDetail = await demoApi(`/api/admin/analytics/redemptions/${broken.id}`);
  assert.equal(brokenDetail.ledger.consistent, false);
  assert.equal(brokenDetail.ledger.delta_points, Number(broken.points_cost));
  assert.deepEqual(brokenDetail.transactions, []);
  const bread = await demoApi(`/api/admin/analytics/rewards/${rewards[1].id}/redemptions`);
  assert.equal(bread.summary.mismatch_count, 0);
  await assert.rejects(demoApi("/api/admin/analytics/rewards/no-such-reward/redemptions"), /Recompensa no encontrada/);
  await assert.rejects(demoApi("/api/admin/analytics/redemptions/no-such-redemption"), /Canje no encontrado/);
});

test("the IVA export is generated locally with the server's columns and range filter", async () => {
  const all = await demoApi("/api/admin/billing/iva.csv");
  assert.equal(all.filename, "reporte_iva_gt.csv");
  const lines = all.csv.trim().split("\n");
  assert.equal(lines[0], "fecha,transacciones,monto_bruto_q,base_sin_iva_q,iva_12_q");
  assert.equal(lines.length - 1, all.rows);
  assert.equal(all.rows, 120);
  const november = await demoApi("/api/admin/billing/iva.csv?from=2026-11-01&to=2026-11-10");
  assert.equal(november.rows, 10);
  const [fecha, transacciones, bruto, base, iva] = november.csv.trim().split("\n")[1].split(",");
  assert.equal(fecha, "2026-11-01");
  assert.ok(Number(transacciones) > 0);
  assert.equal(Math.round((Number(base) + Number(iva)) * 100), Math.round(Number(bruto) * 100));
  assert.equal((await demoApi("/api/admin/billing/iva.csv?from=2027-01-01")).rows, 0);
});

test("an isolated fixture is deterministic for a given clock", () => {
  const api = createOwnerAnalyticsDemoApi(() => new Date("2026-06-15T12:00:00Z"));
  const call = (path, options) => api(new URL(path, "https://preview.invalid"), options);
  const first = call("/api/admin/analytics/dashboard");
  assert.deepEqual(call("/api/admin/analytics/dashboard"), first);
  assert.equal(first.recent_activity[0].date, "2026-06-15", "the series ends on the fixture's today");
  assert.equal(call("/api/admin/analytics/cohorts?months=3").cohorts.filter((row) => row.cohort_name === "2026-06" && Number(row.month_number) > 0).every((row) => Number(row.active_customers) === 0), true, "months that have not started report nobody back, as the server does");
  assert.equal(call("/api/admin/analytics/overview"), undefined, "unknown paths fall through to the rest of the preview");
  assert.equal(call("/api/admin/analytics/dashboard", { method: "POST" }), undefined);
});
