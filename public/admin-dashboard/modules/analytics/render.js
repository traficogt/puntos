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
 * @param {{ latest_run?: Record<string, unknown> | null, recent_runs?: Record<string, unknown>[], latest_findings?: Record<string, unknown>[] }} payload
 */
export function renderLedgerReconciliation($, payload) {
  const summary = $("#ledgerReconciliationSummary");
  const findings = $("#ledgerReconciliationFindings");
  if (!summary || !findings) return;

  const latestRun = payload?.latest_run || null;
  const recentRuns = Array.isArray(payload?.recent_runs) ? payload.recent_runs : [];
  const latestFindings = Array.isArray(payload?.latest_findings) ? payload.latest_findings : [];

  summary.replaceChildren();
  findings.replaceChildren();

  if (!latestRun) {
    summary.textContent = "Aún no hay conciliaciones completadas.";
    findings.textContent = "(sin hallazgos recientes)";
    return;
  }

  const summaryLines = [
    `Última corrida: ${latestRun.completed_at ? new Date(String(latestRun.completed_at)).toLocaleString() : "en progreso"}`,
    `Clientes revisados: ${Number(latestRun.checked_customers || 0)}`,
    `Descuadres detectados: ${Number(latestRun.mismatched_customers || 0)}`,
    `Auto-reparados: ${Number(latestRun.repaired_customers || 0)}`
  ];
  summary.textContent = summaryLines.join("\n");

  if (recentRuns.length > 1) {
    const recent = document.createElement("div");
    recent.className = "mt-8";
    recent.textContent = recentRuns
      .slice(0, 5)
      .map((run) => {
        const when = run.completed_at ? new Date(String(run.completed_at)).toLocaleString() : "en progreso";
        return `${when} • revisados ${Number(run.checked_customers || 0)} • descuadres ${Number(run.mismatched_customers || 0)} • reparados ${Number(run.repaired_customers || 0)}`;
      })
      .join("\n");
    summary.appendChild(recent);
  }

  if (!latestFindings.length) {
    findings.textContent = "Sin descuadres en la última corrida.";
    return;
  }

  latestFindings.slice(0, 10).forEach((finding) => {
    const line = document.createElement("div");
    const repaired = Boolean(finding.repaired);
    line.textContent =
      `${String(finding.customer_id).slice(0, 8)} • ` +
      `pts ${Number(finding.stored_points || 0)} -> ${Number(finding.expected_points || 0)} • ` +
      `pend ${Number(finding.stored_pending_points || 0)} -> ${Number(finding.expected_pending_points || 0)} • ` +
      `life ${Number(finding.stored_lifetime_points || 0)} -> ${Number(finding.expected_lifetime_points || 0)}` +
      (repaired ? " • reparado" : "");
    findings.appendChild(line);
  });
}

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {{ business?: Record<string, unknown>, period?: Record<string, string>, certification_status?: string, summary?: Record<string, unknown>, daily_rows?: Record<string, unknown>[] }} payload
 */
export function renderLedgerCertification($, payload) {
  const summary = $("#ledgerCertificationSummary");
  const rowsBox = $("#ledgerCertificationRows");
  if (!summary || !rowsBox) return;

  const businessName = String(payload?.business?.name || "Negocio");
  const period = payload?.period || {};
  const status = String(payload?.certification_status || "UNKNOWN");
  const s = payload?.summary || {};
  const dailyRows = Array.isArray(payload?.daily_rows) ? payload.daily_rows : [];

  summary.textContent = [
    `${businessName} • ${String(period.from || "—")} a ${String(period.to || "—")}`,
    `Estado: ${status}`,
    `Emitidos: ${Number(s.points_issued || 0)} pts • Canjeados: ${Number(s.points_redeemed || 0)} pts • Reversados: ${Number(s.points_reversed || 0)} pts • Expirados: ${Number(s.points_expired || 0)} pts`,
    `Ajustes manuales: ${Number(s.adjustment_points || 0)} pts`,
    `Gift cards emitidas: Q${Number(s.gift_cards_issued_q || 0).toFixed(2)} • redimidas: Q${Number(s.gift_cards_redeemed_q || 0).toFixed(2)}`,
    `Riesgos abiertos: correcciones pendientes ${Number(s.pending_corrections_count || 0)} • balances negativos ${Number(s.negative_balance_count || 0)} • descuadres última conciliación ${Number(s.latest_reconciliation_mismatches || 0)}`,
    `Última conciliación completada: ${s.latest_reconciliation_completed_at ? new Date(String(s.latest_reconciliation_completed_at)).toLocaleString() : "sin registro"}`
  ].join("\n");

  if (!dailyRows.length) {
    rowsBox.textContent = "Sin movimientos diarios para el periodo seleccionado.";
    return;
  }

  rowsBox.textContent = dailyRows
    .slice(0, 31)
    .map((row) => (
      `${String(row.date)} • emitidos ${Number(row.points_issued || 0)} • canjeados ${Number(row.points_redeemed || 0)} • reversados ${Number(row.points_reversed || 0)} • expirados ${Number(row.points_expired || 0)} • ajustes ${Number(row.adjustment_points || 0)} • GC emitidas Q${Number(row.gift_cards_issued_q || 0).toFixed(2)} • GC redimidas Q${Number(row.gift_cards_redeemed_q || 0).toFixed(2)} • replays ${Number(row.replay_events || 0)}`
    ))
    .join("\n");
}

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {{ retention_days?: number, available_days?: Record<string, unknown>[] }} payload
 */
export function renderLedgerCertificationArchive($, payload) {
  const summary = $("#ledgerCertificationArchiveSummary");
  const list = $("#ledgerCertificationArchiveList");
  if (!summary || !list) return;

  const days = Array.isArray(payload?.available_days) ? payload.available_days : [];
  const retentionDays = Number(payload?.retention_days || 0);

  summary.textContent = [
    `Días disponibles: ${days.length}`,
    `Retención: ${retentionDays || 0} días`
  ].join(" • ");

  list.replaceChildren();
  if (!days.length) {
    list.textContent = "Sin certificaciones históricas disponibles.";
    return;
  }

  days.slice(0, 12).forEach((day) => {
    const row = document.createElement("div");
    row.className = "stack gap-8 mt-8";

    const info = document.createElement("div");
    info.textContent = [
      String(day.date || "—"),
      `estado ${String(day.certification_status || "UNKNOWN")}`,
      `${String(day.period?.from || "—")} a ${String(day.period?.to || "—")}`,
      day.generated_at ? new Date(String(day.generated_at)).toLocaleString() : "sin timestamp"
    ].join(" • ");

    const actions = document.createElement("div");
    actions.className = "row gap-8";

    const jsonLink = document.createElement("a");
    jsonLink.href = String(day.json_url || "#");
    jsonLink.target = "_blank";
    jsonLink.rel = "noopener";
    jsonLink.textContent = "JSON";

    const csvLink = document.createElement("a");
    csvLink.href = String(day.csv_url || "#");
    csvLink.target = "_blank";
    csvLink.rel = "noopener";
    csvLink.textContent = "CSV";

    actions.append(jsonLink, csvLink);
    row.append(info, actions);
    list.appendChild(row);
  });
}

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {{ summary?: Record<string, number>, replay_breakdown?: Record<string, unknown>[], top_refund_actors?: Record<string, unknown>[], negative_balances?: Record<string, unknown>[] }} payload
 */
export function renderValueAnomalies($, payload) {
  const summary = $("#valueAnomaliesSummary");
  const breakdown = $("#valueAnomaliesBreakdown");
  if (!summary || !breakdown) return;

  const s = payload?.summary || {};
  summary.textContent = [
    `Balances negativos: ${Number(s.negative_balance_count || 0)}`,
    `Replays deduplicados (24h): ${Number(s.replay_events_24h || 0)}`,
    `Reversas (24h): ${Number(s.reversals_24h || 0)}`,
    `Correcciones pendientes: ${Number(s.pending_corrections_count || 0)}`,
    `Descuadres última conciliación: ${Number(s.latest_reconciliation_mismatches || 0)}`
  ].join("\n");

  const lines = [];
  const replayBreakdown = Array.isArray(payload?.replay_breakdown) ? payload.replay_breakdown : [];
  if (replayBreakdown.length) {
    lines.push("Replays 24h:");
    replayBreakdown.forEach((row) => {
      lines.push(`- ${String(row.action)}: ${Number(row.count || 0)}`);
    });
  }

  const refundActors = Array.isArray(payload?.top_refund_actors) ? payload.top_refund_actors : [];
  if (refundActors.length) {
    lines.push(lines.length ? "" : "");
    lines.push("Top actores por reversa (24h):");
    refundActors.forEach((row) => {
      lines.push(`- ${String(row.actor_name || "unknown")}: ${Number(row.reversal_count || 0)}`);
    });
  }

  const negativeBalances = Array.isArray(payload?.negative_balances) ? payload.negative_balances : [];
  if (negativeBalances.length) {
    lines.push(lines.length ? "" : "");
    lines.push("Clientes con saldo negativo:");
    negativeBalances.slice(0, 5).forEach((row) => {
      lines.push(`- ${row.name || row.phone || String(row.id).slice(0, 8)}: ${Number(row.points || 0)} pts`);
    });
  }

  breakdown.textContent = lines.length ? lines.join("\n") : "Sin anomalías relevantes en este momento.";
}

/**
 * @param {(selector: string) => HTMLElement | null} $
 * @param {{ corrections?: Record<string, unknown>[] }} payload
 */
export function renderLedgerCorrections($, payload) {
  const box = $("#ledgerCorrectionsList");
  if (!box) return;
  box.replaceChildren();

  const corrections = Array.isArray(payload?.corrections) ? payload.corrections : [];
  if (!corrections.length) {
    box.textContent = "Sin correcciones recientes.";
    return;
  }

  corrections.slice(0, 10).forEach((correction) => {
    const row = document.createElement("div");
    row.className = "stack gap-8 mt-8";

    const summary = document.createElement("div");
    summary.textContent = [
      `#${String(correction.id).slice(0, 8)}`,
      `cliente ${String(correction.customer_id).slice(0, 8)}`,
      `estado ${String(correction.status || "PENDING")}`,
      `pts ${Number(correction.requested_stored_points || 0)} -> ${Number(correction.requested_expected_points || 0)}`,
      `pend ${Number(correction.requested_stored_pending_points || 0)} -> ${Number(correction.requested_expected_pending_points || 0)}`,
      `life ${Number(correction.requested_stored_lifetime_points || 0)} -> ${Number(correction.requested_expected_lifetime_points || 0)}`
    ].join(" • ");

    const reason = document.createElement("div");
    reason.className = "small";
    reason.textContent = String(correction.reason || "");

    row.append(summary, reason);

    if (String(correction.status) === "PENDING") {
      const actions = document.createElement("div");
      actions.className = "row gap-8";

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.dataset.correctionApply = String(correction.id);
      applyBtn.textContent = "Aplicar";

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.dataset.correctionReject = String(correction.id);
      rejectBtn.textContent = "Rechazar";

      actions.append(applyBtn, rejectBtn);
      row.appendChild(actions);
    }

    box.appendChild(row);
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
    const track = document.createElement("progress");
    track.className = "rfm-track";
    track.max = 100;
    track.value = Math.max(2, (Number(segment.count || 0) / total) * 100);
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
    const line = document.createElement("div");
    line.className = "trend-row";
    const label = document.createElement("span");
    label.className = "small";
    label.textContent = new Date(row.date).toLocaleDateString();
    const bar = document.createElement("progress");
    bar.className = "trend-progress";
    bar.max = 100;
    bar.value = Math.max(4, Math.round((revenue / max) * 100));
    bar.title = `${new Date(row.date).toLocaleDateString()} • Q${revenue.toFixed(2)}`;
    const value = document.createElement("span");
    value.className = "small";
    value.textContent = `Q${revenue.toFixed(2)}`;
    line.append(label, bar, value);
    bars.appendChild(line);
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
    div.className = "card mb-8";
    const row = document.createElement("div");
    row.className = "row row-between";

    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = customer.name || customer.phone;
    left.appendChild(name);
    const days = document.createElement("div");
    days.className = "small";
    days.textContent = `${customer.days_since_last_purchase} días sin visitar`;
    left.appendChild(days);

    const right = document.createElement("div");
    right.className = "row gap-8";
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
    const track = document.createElement("progress");
    track.className = "branch-track";
    track.max = 100;
    track.value = Math.max(4, (Number(rowData.revenue_30d || 0) / maxRevenue) * 100);
    const value = document.createElement("span");
    value.className = "small";
    value.textContent = `Q${Number(rowData.revenue_30d || 0).toFixed(2)} • Tx ${Number(rowData.tx_30d || 0)}`;
    row.append(name, track, value);
    perfContainer.appendChild(row);
  });
  return perfRows;
}
