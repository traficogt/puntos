function formatCount(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 0 }).format(num);
}

function formatCurrency(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `Q${new Intl.NumberFormat("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)}`;
}

function formatPercent(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `${num.toFixed(1)}%`;
}

function formatSignedPercent(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(1)}%`;
}

function formatFrequency(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `${num.toFixed(2)}x`;
}

function formatRatio(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `${num.toFixed(2)}x`;
}

function setText($, selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function setList($, selector, items) {
  const node = $(selector);
  if (!node) return;
  node.replaceChildren();
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    node.appendChild(li);
  });
}

function firstBranchRow(branchPerformance) {
  return Array.isArray(branchPerformance) && branchPerformance.length ? branchPerformance[0] : null;
}

function computeRetentionRate({ branchId, activeCustomers, totalCustomers, roi }) {
  if (branchId && Number(totalCustomers) > 0 && Number(activeCustomers) >= 0) {
    return (Number(activeCustomers) / Number(totalCustomers)) * 100;
  }
  if (roi?.repeat_rate_pct !== null && roi?.repeat_rate_pct !== undefined) {
    return Number(roi.repeat_rate_pct);
  }
  if (Number(totalCustomers) > 0 && Number(activeCustomers) >= 0) {
    return (Number(activeCustomers) / Number(totalCustomers)) * 100;
  }
  return null;
}

function executiveMetrics({ summary, roiReport, branchPerformance, branchId }) {
  const roi = roiReport?.roi || {};
  const branchRow = firstBranchRow(branchPerformance);
  const totalCustomers = Number(summary?.total_customers || 0);
  const activeCustomers = branchId
    ? Number(branchRow?.active_customers_30d || 0)
    : (roi.customers_active !== null && roi.customers_active !== undefined
      ? Number(roi.customers_active)
      : null);
  const newCustomers = Number(summary?.new_customers_30d || 0);
  const purchaseFrequency = Number(summary?.avg_purchase_frequency || 0);
  const attributedRevenue = branchId
    ? Number(branchRow?.revenue_30d || 0)
    : (roi.revenue_current_q !== null && roi.revenue_current_q !== undefined
      ? Number(roi.revenue_current_q)
      : null);
  const retentionRate = computeRetentionRate({ branchId, activeCustomers, totalCustomers, roi });
  const roiGrowth = roi.revenue_growth_pct !== null && roi.revenue_growth_pct !== undefined
    ? Number(roi.revenue_growth_pct)
    : null;
  const roiRatio = roi.roi_ratio !== null && roi.roi_ratio !== undefined
    ? Number(roi.roi_ratio)
    : null;
  const costProxyRate = roi.redemption_rate_pct !== null && roi.redemption_rate_pct !== undefined
    ? Number(roi.redemption_rate_pct)
    : null;

  return {
    totalCustomers,
    activeCustomers,
    newCustomers,
    purchaseFrequency,
    retentionRate,
    attributedRevenue,
    roiRatio,
    costProxyRate,
    roiGrowth,
    txGrowth: roi.tx_growth_pct !== null && roi.tx_growth_pct !== undefined ? Number(roi.tx_growth_pct) : null
  };
}

export function adminExecutiveNarrative({ branchLabel, metrics, churnData, alertsCenter, branchId }) {
  const riskCount = Number(churnData?.count ?? churnData?.customers?.length ?? 0);
  const alertCount = Array.isArray(alertsCenter?.alerts) ? alertsCenter.alerts.length : 0;
  const retentionText = metrics.retentionRate !== null ? formatPercent(metrics.retentionRate) : "sin lectura de retención";
  const growthText = metrics.roiGrowth !== null
    ? `${branchId ? "y una referencia global de ingresos de" : "y un pulso de ingresos de"} ${formatSignedPercent(metrics.roiGrowth)}`
    : "sin lectura de ROI consolidado";
  const alertsText = branchId ? `${formatCount(alertCount)} alertas operativas globales abiertas` : `${formatCount(alertCount)} alertas operativas abiertas`;
  return `${branchLabel || "Todo el negocio"} mantiene ${formatCount(metrics.activeCustomers)} clientes activos, sumó ${formatCount(metrics.newCustomers)} nuevos en 30 días, retiene ${retentionText} ${growthText}; hoy hay ${formatCount(riskCount)} clientes en riesgo alto y ${alertsText}.`;
}

export function adminSuggestedActions({ metrics, churnData, alertsCenter, branchId }) {
  const riskCount = Number(churnData?.count ?? churnData?.customers?.length ?? 0);
  const alerts = Array.isArray(alertsCenter?.alerts) ? alertsCenter.alerts : [];
  const highAlerts = alerts.filter((alert) => String(alert?.severity || "").toUpperCase() === "HIGH").length;
  const actions = [];
  const alertsScope = branchId ? " como referencia global" : "";
  const roiScope = branchId ? " como referencia global" : "";

  if (riskCount > 0) {
    actions.push(`Activa un win-back para los ${formatCount(riskCount)} clientes con mayor riesgo antes del próximo corte.`);
  }
  if (highAlerts > 0 || alerts.length >= 6) {
    actions.push(`Prioriza el centro de alertas${alertsScope}: hay ${formatCount(highAlerts || alerts.length)} señales que conviene limpiar hoy.`);
  }
  if (metrics.retentionRate !== null && metrics.retentionRate < 45) {
    actions.push("Refuerza la segunda compra con una recompensa simple y un recordatorio al staff en caja.");
  } else if (metrics.roiGrowth !== null && metrics.roiGrowth < 0) {
    actions.push(`Revisa incentivos y ticket promedio${roiScope}; el ingreso atribuido viene por debajo del periodo previo.`);
  } else {
    actions.push("Mantén la operación actual y monitorea recurrencia y alertas en el siguiente refresco.");
  }

  return actions.slice(0, 3);
}

export function renderExecutiveSummary({
  $,
  summary,
  roiReport,
  churnData,
  alertsCenter,
  branchLabel,
  branchPerformance,
  branchId
}) {
  const metrics = executiveMetrics({ summary, roiReport, branchPerformance, branchId });

  setText($, "#adminGrowthScope", branchLabel || "Todo el negocio");
  setText($, "#adminKpiActiveCustomers", formatCount(metrics.activeCustomers));
  setText($, "#adminKpiActiveCustomersDelta", metrics.totalCustomers > 0 ? `Base medida: ${formatCount(metrics.totalCustomers)} clientes` : "Base de clientes sin detalle");
  setText($, "#adminKpiNewCustomers", formatCount(metrics.newCustomers));
  setText($, "#adminKpiNewCustomersDelta", "Captados en los últimos 30 días");
  setText($, "#adminKpiPurchaseFrequency", formatFrequency(metrics.purchaseFrequency));
  setText($, "#adminKpiPurchaseFrequencyDelta", "Promedio mensual por cliente");
  setText($, "#adminKpiRetention", formatPercent(metrics.retentionRate));
  setText($, "#adminKpiRetentionDelta", "Relación entre clientes activos y base medida");
  setText($, "#adminKpiAttributedRevenue", formatCurrency(metrics.attributedRevenue));
  setText($, "#adminKpiAttributedRevenueDelta", metrics.roiGrowth !== null ? `${formatSignedPercent(metrics.roiGrowth)} vs 30d previos${branchId ? " (referencia global)" : ""}` : "Ingresos medidos en 30 días");
  setText($, "#adminKpiRoi", metrics.roiRatio !== null ? formatRatio(metrics.roiRatio) : formatPercent(metrics.costProxyRate));
  setText($, "#adminKpiRoiDelta", metrics.roiRatio !== null
    ? `Retorno por costo${branchId ? " (referencia global)" : ""}`
    : `Proxy de costo: tasa de canje${branchId ? " global" : ""}`);

  setText($, "#adminExecutiveNarrative", adminExecutiveNarrative({
    branchLabel,
    metrics,
    churnData,
    alertsCenter,
    branchId
  }));
  setList($, "#adminSuggestedActions", adminSuggestedActions({
    metrics,
    churnData,
    alertsCenter,
    branchId
  }));
}
