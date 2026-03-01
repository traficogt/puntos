/** @typedef {import("../../types.js").AdminDashboardApp} AdminDashboardApp */
/** @typedef {import("../../types.js").AnalyticsSummary} AnalyticsSummary */
/** @typedef {import("../../types.js").AnalyticsRfmSegment} AnalyticsRfmSegment */
/** @typedef {import("../../types.js").AnalyticsActivityRow} AnalyticsActivityRow */
/** @typedef {import("../../types.js").AnalyticsChurnCustomer} AnalyticsChurnCustomer */
/** @typedef {import("../../types.js").AnalyticsBranchPerformanceRow} AnalyticsBranchPerformanceRow */
/** @typedef {import("../../types.js").AnalyticsDashboardResponse} AnalyticsDashboardResponse */

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {AnalyticsSummary | undefined} summary
 */
export function renderAnalyticsStory($, summary) {
  const box = $("#analyticsStory");
  if (!box) return;
  box.replaceChildren();
  [
    `Clientes totales: ${Number(summary?.total_customers || 0)}`,
    `Nuevos 30d: ${Number(summary?.new_customers_30d || 0)}`,
    `En riesgo: ${Number(summary?.high_churn_risk_count || 0)}`,
    `Gasto promedio: Q${Number(summary?.avg_customer_spend || 0).toFixed(2)}`
  ].forEach((text) => {
    const div = document.createElement("div");
    div.className = "badge";
    div.textContent = text;
    box.appendChild(div);
  });
}

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {AnalyticsSummary | undefined} summary
 */
export function renderGrowthRadar($, summary) {
  const box = $("#growthRadar");
  if (!box) return;
  box.textContent = `Adquisición (30d): ${Number(summary?.new_customers_30d || 0)} • Riesgo: ${Number(summary?.high_churn_risk_count || 0)}`;
}

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {AnalyticsSummary | undefined} summary
 */
export function renderSmartAlerts($, summary) {
  const box = $("#smartAlerts");
  if (!box) return;
  const risk = Number(summary?.high_churn_risk_count || 0);
  box.textContent = risk > 0
    ? `Sugerencia: activa win-back para ${risk} clientes en riesgo.`
    : "Sin alertas críticas de churn.";
}

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {AnalyticsBranchPerformanceRow[]} perfRows
 */
export function renderBranchCompareTable($, perfRows) {
  const box = $("#branchCompareTable");
  if (!box) return;
  box.replaceChildren();
  if (!perfRows.length) {
    box.textContent = "(sin datos)";
    return;
  }
  perfRows.forEach((rowData) => {
    const line = document.createElement("div");
    const label = rowData.branch_code ? `${rowData.branch_name} (${rowData.branch_code})` : rowData.branch_name;
    line.textContent = `${label}: Q${Number(rowData.revenue_30d || 0).toFixed(2)} • Tx ${Number(rowData.tx_30d || 0)} • Canjes ${Number(rowData.redemptions_30d || 0)}`;
    box.appendChild(line);
  });
}

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {{ branchRows: AnalyticsActivityRow[]; globalRows: AnalyticsActivityRow[]; branchLabel: string }} args
 */
export function renderBranchBenchmark($, { branchRows, globalRows, branchLabel }) {
  const box = $("#branchBenchmark");
  if (!box) return;
  box.replaceChildren();
  if (!Array.isArray(branchRows) || !Array.isArray(globalRows) || !branchRows.length || !globalRows.length) {
    box.textContent = "(sin datos)";
    return;
  }

  /**
   * @param {AnalyticsActivityRow[]} rows
   * @returns {Map<string, number>}
   */
  const mapByDate = (rows) => {
    const out = new Map();
    rows.forEach((row) => out.set(String(row.date).slice(0, 10), Number(row.revenue || 0)));
    return out;
  };
  const branchMap = mapByDate(branchRows);
  const globalMap = mapByDate(globalRows);
  const dates = Array.from(new Set([...branchMap.keys(), ...globalMap.keys()])).sort().slice(-10);

  const rowsWrap = document.createElement("div");
  rowsWrap.className = "benchmark-list";
  dates.forEach((date) => {
    const branchRevenue = Number(branchMap.get(date) || 0);
    const globalRevenue = Number(globalMap.get(date) || 0);
    const share = globalRevenue > 0 ? Math.round((branchRevenue / globalRevenue) * 100) : 0;

    const line = document.createElement("div");
    line.className = "benchmark-row";
    const dateNode = document.createElement("span");
    dateNode.textContent = new Date(date).toLocaleDateString();
    const branchNode = document.createElement("span");
    branchNode.textContent = `${branchLabel}: Q${branchRevenue.toFixed(0)}`;
    const globalNode = document.createElement("span");
    globalNode.textContent = `Global: Q${globalRevenue.toFixed(0)}`;
    const shareNode = document.createElement("strong");
    shareNode.textContent = `${share}%`;
    line.append(dateNode, branchNode, globalNode, shareNode);
    rowsWrap.appendChild(line);
  });
  box.appendChild(rowsWrap);
}

/**
 * @param {{ $: (selector: string) => HTMLElement | null; summary: AnalyticsSummary | undefined; app: AdminDashboardApp }} args
 */
export function renderSummaryTiles({ $, summary, app }) {
  const summaryEl = $("#analyticsSummary");
  summaryEl.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "analytics-kpi-grid";
  [
    { value: Number(summary.total_customers || 0), label: "Clientes totales", money: false },
    { value: Number(summary.new_customers_30d || 0), label: "Nuevos (30d)", money: false },
    { value: Number(summary.high_churn_risk_count || 0), label: "En riesgo", money: false },
    { value: Number(summary.avg_customer_spend || 0).toFixed(2), label: "Gasto promedio", money: true }
  ].forEach(({ value, label, money }) => {
    const card = document.createElement("div");
    card.className = "metric-tile";
    const key = document.createElement("div");
    key.className = "metric-value";
    key.textContent = money ? `Q${value}` : String(value);
    const text = document.createElement("div");
    text.className = "metric-label";
    text.textContent = String(label);
    card.append(key, text);
    grid.appendChild(card);
  });
  summaryEl.appendChild(grid);

  renderAnalyticsStory($, summary);
  renderGrowthRadar($, summary);
  renderSmartAlerts($, summary);

  const scope = $("#analyticsScopeHint");
  if (scope) scope.textContent = `Vista actual: ${app.selectedBranchLabel()}`;
  $("#lastCalc").textContent = new Date().toLocaleString();
}

/**
 * @param {{ $: (selector: string) => HTMLElement | null; dashboard: AnalyticsDashboardResponse; app: AdminDashboardApp }} args
 */
export function renderRfmDistribution({ $, dashboard, app }) {
  const rfmContainer = $("#rfmDist");
  rfmContainer.replaceChildren();
  const rfmDist = /** @type {AnalyticsRfmSegment[]} */ (Array.isArray(dashboard.rfm_distribution) ? dashboard.rfm_distribution : []);
  if (!rfmDist.length) {
    app.setSmallMessage(rfmContainer, "No hay datos RFM todavía.");
    return;
  }

  const segName = { Champions: "Campeones", Loyal: "Leales", "At Risk": "En riesgo", Lost: "Perdidos" };
  const total = rfmDist.reduce((acc, row) => acc + Number(row.count || 0), 0) || 1;
  rfmDist.forEach((segment) => {
    const row = document.createElement("div");
    row.className = "rfm-row";
    const label = document.createElement("span");
    label.textContent = segName[segment.segment] || segment.segment;
    const track = document.createElement("div");
    track.className = "rfm-track";
    const fill = document.createElement("div");
    fill.className = "rfm-fill";
    fill.style.width = `${Math.max(2, (Number(segment.count || 0) / total) * 100)}%`;
    track.appendChild(fill);
    const right = document.createElement("span");
    right.className = "small";
    right.textContent = `${segment.count}`;
    row.append(label, track, right);
    rfmContainer.appendChild(row);
  });
}

/**
 * @param {{ $: (selector: string) => HTMLElement | null; dashboard: AnalyticsDashboardResponse; app: AdminDashboardApp }} args
 * @returns {AnalyticsActivityRow[]}
 */
export function renderRevenueTrend({ $, dashboard, app }) {
  const trendContainer = $("#revenueTrend");
  trendContainer.replaceChildren();
  const activityRows = /** @type {AnalyticsActivityRow[]} */ (Array.isArray(dashboard.recent_activity) ? dashboard.recent_activity : []);
  if (!activityRows.length) {
    app.setSmallMessage(trendContainer, "No hay actividad reciente para graficar.");
    return activityRows;
  }

  const values = activityRows.map((row) => Number(row.revenue || 0));
  const max = Math.max(...values, 1);
  const bars = document.createElement("div");
  bars.className = "trend-bars";
  activityRows.slice().reverse().forEach((row) => {
    const revenue = Number(row.revenue || 0);
    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.style.height = `${Math.max(4, Math.round((revenue / max) * 140))}px`;
    bar.title = `${new Date(row.date).toLocaleDateString()} • Q${revenue.toFixed(2)}`;
    bars.appendChild(bar);
  });
  trendContainer.appendChild(bars);
  return activityRows;
}

/**
 * @param {{ $: (selector: string) => HTMLElement | null; churnCustomers: AnalyticsChurnCustomer[]; app: AdminDashboardApp }} args
 */
export function renderChurnList({ $, churnCustomers, app }) {
  const churnContainer = $("#churnList");
  churnContainer.replaceChildren();
  if (!churnCustomers.length) {
    app.setSmallMessage(churnContainer, "¡Todos los clientes están activos!");
    return;
  }

  churnCustomers.forEach((customer) => {
    const div = document.createElement("div");
    div.className = "card";
    div.style.marginBottom = "8px";
    const row = document.createElement("div");
    row.className = "row";
    row.style.justifyContent = "space-between";

    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = customer.name || customer.phone;
    left.appendChild(name);
    const days = document.createElement("div");
    days.className = "small";
    days.textContent = `${customer.days_since_last_purchase} días sin visitar`;
    left.appendChild(days);

    const right = document.createElement("div");
    right.className = "row";
    right.style.gap = "8px";
    const risk = document.createElement("span");
    risk.className = "badge";
    risk.textContent = `Riesgo: ${(customer.churn_risk_score * 100).toFixed(0)}%`;
    const spend = document.createElement("span");
    spend.className = "badge";
    spend.textContent = `Q${Number(customer.total_spend || 0).toFixed(2)} gastado`;
    right.append(risk, spend);
    row.append(left, right);
    div.appendChild(row);
    churnContainer.appendChild(div);
  });
}

/**
 * @param {{ $: (selector: string) => HTMLElement | null; dashboard: AnalyticsDashboardResponse; app: AdminDashboardApp }} args
 * @returns {AnalyticsBranchPerformanceRow[]}
 */
export function renderBranchPerformance({ $, dashboard, app }) {
  const perfContainer = $("#branchPerformance");
  const perfRows = /** @type {AnalyticsBranchPerformanceRow[]} */ (Array.isArray(dashboard.branch_performance) ? dashboard.branch_performance : []);
  perfContainer.replaceChildren();
  if (!perfRows.length) {
    app.setSmallMessage(perfContainer, "No hay sucursales o no hay actividad reciente.");
    return perfRows;
  }

  const maxRevenue = Math.max(...perfRows.map((row) => Number(row.revenue_30d || 0)), 1);
  perfRows.forEach((rowData) => {
    const row = document.createElement("div");
    row.className = "branch-row";
    row.title = "Click para filtrar por esta sucursal";
    row.addEventListener("click", () => {
      app.applyBranchDrilldown(rowData.branch_id).catch(() => {});
    });
    const name = document.createElement("span");
    name.textContent = rowData.branch_code ? `${rowData.branch_name} (${rowData.branch_code})` : rowData.branch_name;
    const track = document.createElement("div");
    track.className = "branch-track";
    const fill = document.createElement("div");
    fill.className = "branch-fill";
    fill.style.width = `${Math.max(4, (Number(rowData.revenue_30d || 0) / maxRevenue) * 100)}%`;
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "small";
    value.textContent = `Q${Number(rowData.revenue_30d || 0).toFixed(2)} • Tx ${Number(rowData.tx_30d || 0)}`;
    row.append(name, track, value);
    perfContainer.appendChild(row);
  });
  return perfRows;
}
