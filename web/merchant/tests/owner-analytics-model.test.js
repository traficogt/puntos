import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentFilename,
  benchmarkRows,
  cohortMatrix,
  currentMonthRange,
  executiveMetrics,
  executiveNarrative,
  formatters,
  ivaCsv,
  ivaCsvRows,
  ivaExportPath,
  ivaRangeIssue,
  redemptionConsistent,
  rfmSegments,
  suggestedActions,
  trendRows,
} from "../src/owner-analytics-model.ts";

const summary = { total_customers: "212", new_customers_30d: "23", total_points_issued: "1680", avg_points_per_customer: "7.9", high_churn_risk_count: "9", avg_customer_spend: "318.40", avg_purchase_frequency: "1.80" };
const roi = { revenue_current_q: 16800, revenue_previous_q: 13944, revenue_growth_pct: 20.48, tx_current: 470, tx_previous: 400, tx_growth_pct: 17.5, customers_total: 212, customers_active: 184, repeat_rate_pct: 86.79, redemptions: 47, redemption_rate_pct: 10 };
const branchRow = { branch_id: "b1", branch_name: "Zona 4", branch_code: "z4", tx_30d: 258, revenue_30d: "9240.00", active_customers_30d: 101, redemptions_30d: 26, avg_ticket_30d: "35.81" };

test("executive metrics read the whole business from /admin/roi and a branch from its own row", () => {
  const whole = executiveMetrics({ summary, roi, branchPerformance: [branchRow], branchId: null, riskCount: 9 });
  assert.equal(whole.activeCustomers, 184);
  assert.equal(whole.recordedSales, 16800);
  assert.equal(Math.round(whole.retentionRate), 87, "whole business: active over total as the server reports it");
  assert.equal(whole.salesGrowth, 20.48);
  const branch = executiveMetrics({ summary: { ...summary, total_customers: "140" }, roi, branchPerformance: [branchRow], branchId: "b1", riskCount: 4 });
  assert.equal(branch.activeCustomers, 101);
  assert.equal(branch.recordedSales, 9240);
  assert.equal(Math.round(branch.retentionRate * 10) / 10, 72.1, "branch: active in the branch over the branch's measured base");
  const missing = executiveMetrics({ summary, roi: undefined, branchPerformance: [], branchId: null, riskCount: 0 });
  assert.equal(missing.activeCustomers, null, "no ROI reading stays null instead of becoming zero");
  assert.equal(missing.retentionRate, null);
  assert.equal(missing.salesGrowth, null);
});

test("the narrative names every reading and says when one is missing", () => {
  const format = formatters("es-GT");
  const metrics = executiveMetrics({ summary, roi, branchPerformance: [], branchId: null, riskCount: 9 });
  const text = executiveNarrative("Todas las sucursales", metrics, null, format);
  assert.match(text, /^Todas las sucursales tiene 184 clientes activos en 30 días \(86\.8% de la base medida\), sumó 23 nuevos y ventas registradas \+20\.5% frente a los 30 días previos; hoy hay 9 clientes en riesgo alto\.$/);
  const noRoi = executiveNarrative("", executiveMetrics({ summary, roi: null, branchPerformance: [], branchId: null, riskCount: 0 }), null, format);
  assert.match(noRoi, /^Todo el negocio tiene — clientes activos/);
  assert.match(noRoi, /sin lectura de la base medida/);
  assert.match(noRoi, /sin ventas comparables en los 30 días previos/);
  const inBranch = executiveNarrative("Zona 4", executiveMetrics({ summary, roi, branchPerformance: [branchRow], branchId: "b1", riskCount: 2 }), "b1", format);
  assert.match(inBranch, /\(referencia global\)/, "inside a branch the sales comparison is flagged as global");
});

test("suggested actions follow the readings and never exceed three", () => {
  const format = formatters("es-GT");
  const risky = suggestedActions({ ...executiveMetrics({ summary, roi, branchPerformance: [], branchId: null, riskCount: 9 }), retentionRate: 30 }, null, format);
  assert.equal(risky.length, 2);
  assert.match(risky[0], /9 clientes con mayor riesgo/);
  assert.match(risky[1], /segunda compra/);
  const falling = suggestedActions({ ...executiveMetrics({ summary, roi, branchPerformance: [], branchId: null, riskCount: 0 }), salesGrowth: -4 }, "b1", format);
  assert.deepEqual(falling, ["Revisa incentivos y ticket promedio como referencia global; las ventas registradas vienen por debajo del período previo."]);
  const steady = suggestedActions(executiveMetrics({ summary, roi, branchPerformance: [], branchId: null, riskCount: 0 }), null, format);
  assert.deepEqual(steady, ["Mantén la operación actual y revisa recurrencia y riesgo en el siguiente refresco."]);
});

test("RFM segments keep a fixed order, fill missing segments with zero and share the total", () => {
  const segments = rfmSegments([{ segment: "Lost", count: "47" }, { segment: "Champions", count: "38" }, { segment: "Loyal", count: "71" }]);
  assert.deepEqual(segments.map((segment) => segment.label), ["Campeones", "Leales", "En riesgo", "Perdidos"]);
  assert.deepEqual(segments.map((segment) => segment.count), [38, 71, 0, 47]);
  assert.equal(segments[0].sharePct, 24.4);
  assert.deepEqual(rfmSegments([]).map((segment) => segment.sharePct), [0, 0, 0, 0]);
  assert.equal(rfmSegments(null).length, 4);
});

test("trend and benchmark rows sort oldest first and compute the branch share per day", () => {
  const trend = trendRows([{ date: "2026-11-10T06:00:00.000Z", active_customers: "8", transactions: "12", revenue: "504" }, { date: "2026-11-09T06:00:00.000Z", active_customers: "5", transactions: "9", revenue: "396.50" }]);
  assert.deepEqual(trend.map((row) => row.date), ["2026-11-09", "2026-11-10"]);
  assert.equal(trend[0].revenue, 396.5);
  const bench = benchmarkRows(
    [{ date: "2026-11-10", revenue: "100", active_customers: 1, transactions: 1 }, { date: "2026-11-08", revenue: "30", active_customers: 1, transactions: 1 }],
    [{ date: "2026-11-10", revenue: "400", active_customers: 1, transactions: 1 }, { date: "2026-11-09", revenue: "200", active_customers: 1, transactions: 1 }],
  );
  assert.deepEqual(bench, [
    { date: "2026-11-08", branch: 30, global: 0, sharePct: 0 },
    { date: "2026-11-09", branch: 0, global: 200, sharePct: 0 },
    { date: "2026-11-10", branch: 100, global: 400, sharePct: 25 },
  ]);
  assert.deepEqual(benchmarkRows([], [{ date: "2026-11-10", revenue: 1, active_customers: 1, transactions: 1 }]), []);
  assert.equal(benchmarkRows(Array.from({ length: 15 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, revenue: 1, active_customers: 1, transactions: 1 })), [{ date: "2026-10-15", revenue: 2, active_customers: 1, transactions: 1 }]).length, 10);
});

test("the cohort matrix pivots server rows and marks months that have not started as pending", () => {
  const rows = [];
  for (const [name, size] of [["2026-10", 23], ["2026-09", 27]]) {
    for (let month = 0; month <= 12; month += 1) rows.push({ cohort_name: name, cohort_date: `${name}-01T06:00:00.000Z`, cohort_size: size, month_number: month, active_customers: month === 0 ? String(size) : month === 1 ? "9" : "0", retention_rate: month === 0 ? "100.00" : month === 1 ? "39.13" : "0", revenue: "0" });
  }
  const matrix = cohortMatrix(rows, { maxMonth: 3, now: new Date("2026-11-10T18:00:00Z") });
  assert.deepEqual(matrix.months, [0, 1, 2, 3]);
  assert.deepEqual(matrix.cohorts.map((line) => line.name), ["2026-10", "2026-09"], "newest cohort first");
  const october = matrix.cohorts[0];
  assert.equal(october.size, 23);
  assert.deepEqual(october.cells.map((cell) => cell.pending), [false, false, true, true], "October + 2 months is January, not started yet");
  assert.equal(october.cells[1].rate, 39.13);
  const september = matrix.cohorts[1];
  assert.deepEqual(september.cells.map((cell) => cell.pending), [false, false, false, true]);
  assert.deepEqual(cohortMatrix([]).cohorts, []);
  assert.deepEqual(cohortMatrix(undefined).months, []);
});

test("redemption consistency is the server rule: one linked movement equal to minus the cost", () => {
  assert.equal(redemptionConsistent({ points_cost: 100, linked_points_total: "-100", linked_transaction_count: "1" }), true);
  assert.equal(redemptionConsistent({ points_cost: 100, linked_points_total: 0, linked_transaction_count: 0 }), false);
  assert.equal(redemptionConsistent({ points_cost: 100, linked_points_total: -100, linked_transaction_count: 2 }), false);
});

test("the IVA CSV splits the gross amount so the three money columns add up exactly", () => {
  const rows = ivaCsvRows([{ fecha: "2026-11-01T06:00:00.000Z", transacciones: 3, monto_bruto_q: "112.00" }, { fecha: "2026-11-02", transacciones: 1, monto_bruto_q: 10.01 }, { fecha: "2026-11-03", transacciones: 1, monto_bruto_q: 0 }]);
  assert.deepEqual(rows[0], { fecha: "2026-11-01", transacciones: 3, monto_bruto_q: "112.00", base_sin_iva_q: "100.00", iva_12_q: "12.00" });
  assert.deepEqual(rows[1], { fecha: "2026-11-02", transacciones: 1, monto_bruto_q: "10.01", base_sin_iva_q: "8.94", iva_12_q: "1.07" }, "1001/1.12 = 893.75 centavos rounds half up to 894");
  assert.deepEqual(rows[2], { fecha: "2026-11-03", transacciones: 1, monto_bruto_q: "0.00", base_sin_iva_q: "0.00", iva_12_q: "0.00" });
  for (const row of rows) assert.equal(Math.round((Number(row.base_sin_iva_q) + Number(row.iva_12_q)) * 100), Math.round(Number(row.monto_bruto_q) * 100));
  const csv = ivaCsv([{ fecha: "2026-11-01", transacciones: 3, monto_bruto_q: 112 }]);
  assert.equal(csv, "fecha,transacciones,monto_bruto_q,base_sin_iva_q,iva_12_q\n2026-11-01,3,112.00,100.00,12.00\n");
  assert.equal(ivaCsv([]), "fecha,transacciones,monto_bruto_q,base_sin_iva_q,iva_12_q\n");
});

test("IVA export query, range validation and download names", () => {
  assert.equal(ivaExportPath("2026-11-01", "2026-11-30"), "/api/admin/billing/iva.csv?from=2026-11-01&to=2026-11-30");
  assert.equal(ivaExportPath("", ""), "/api/admin/billing/iva.csv");
  assert.equal(ivaExportPath("bad", "2026-11-30"), "/api/admin/billing/iva.csv?to=2026-11-30", "an invalid date is dropped, never sent");
  assert.equal(ivaRangeIssue("2026-11-01", "2026-11-30"), null);
  assert.equal(ivaRangeIssue("", ""), null);
  assert.match(ivaRangeIssue("2026-12-01", "2026-11-30"), /anterior o igual/);
  assert.match(ivaRangeIssue("2026-13-01", ""), /inicial no es válida/);
  assert.equal(attachmentFilename('attachment; filename="reporte_iva_gt.csv"'), "reporte_iva_gt.csv");
  assert.equal(attachmentFilename("attachment; filename=otro.csv"), "otro.csv");
  assert.equal(attachmentFilename("attachment; filename*=UTF-8''informe%20iva.csv"), "informe iva.csv");
  assert.equal(attachmentFilename(null), "reporte_iva_gt.csv");
  assert.equal(attachmentFilename('attachment; filename="../x.csv"'), "reporte_iva_gt.csv", "path separators fall back to the known name");
  assert.deepEqual(currentMonthRange(new Date("2026-11-10T03:00:00Z"), "America/Guatemala"), { from: "2026-11-01", to: "2026-11-09" }, "the business day, not the UTC day");
  assert.deepEqual(currentMonthRange(new Date("2026-11-01T12:00:00Z"), "America/Guatemala"), { from: "2026-11-01", to: "2026-11-01" });
});
