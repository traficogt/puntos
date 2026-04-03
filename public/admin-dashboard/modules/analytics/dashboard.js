import { loadCohortSummary } from "./cohorts.js";
import { hydrateExecutiveSummary } from "./executive-summary-loader.js";
import {
  applyLedgerCorrection,
  ensureLedgerCertificationDates,
  exportLedgerCertificationCsv,
  loadLedgerCertification,
  loadLedgerCertificationArchive,
  loadLedgerCorrections,
  rejectLedgerCorrection,
  requestLedgerCorrection,
  renderBranchBenchmark,
  renderBranchCompareTable,
  renderBranchPerformance,
  renderChurnList,
  renderLedgerReconciliation,
  renderRevenueTrend,
  renderRfmDistribution,
  renderSummaryTiles,
  renderValueAnomalies
} from "./render.js";
/** @typedef {import("../../types.js").AdminDashboardApp} AdminDashboardApp */
/** @typedef {import("../../types.js").AnalyticsDashboardDeps} AnalyticsDashboardDeps */
/** @typedef {import("../../types.js").AnalyticsLoadController} AnalyticsLoadController */

/**
 * @param {AdminDashboardApp} app
 * @param {AnalyticsDashboardDeps} deps
 * @returns {AnalyticsLoadController}
 */
export function createAnalyticsDashboardController(app, deps) {
  const { api, $, toast } = app;
  const {
    loadOpsSummary,
    loadJobsStatus,
    loadPaymentPending,
    loadAuditTimeline
  } = deps;
  async function loadAnalytics() {
    try {
      const query = app.branchQueryString();
      const branchId = app.selectedBranchId();
      const [dashboard, globalDashboard] = await Promise.all([
        api(`/api/admin/analytics/dashboard${query ? `?${query}` : ""}`),
        branchId ? api("/api/admin/analytics/dashboard") : Promise.resolve(null)
      ]);
      const roiPrefetchPromise = api("/api/admin/roi?days=30");
      const alertsPrefetchPromise = api("/api/admin/alerts?limit=60");
      renderSummaryTiles({ $, summary: dashboard.summary || {}, app });
      renderRfmDistribution({ $, dashboard, app });
      const activityRows = renderRevenueTrend({ $, dashboard, app });
      const churnDataPromise = api(`/api/admin/analytics/churn-risk?limit=10${query ? `&${query}` : ""}`);
      const perfRows = renderBranchPerformance({ $, dashboard, app });
      renderBranchCompareTable($, perfRows);
      await loadCohortSummary({ $, api });
      const benchmarkBranchRows = branchId ? activityRows : [];
      const benchmarkGlobalRows = branchId ? (globalDashboard?.recent_activity || []) : activityRows;
      renderBranchBenchmark($, { branchRows: benchmarkBranchRows, globalRows: benchmarkGlobalRows, branchLabel: app.selectedBranchLabel() });
      await loadOpsSummary();
      await loadJobsStatus();
      await loadPaymentPending();
      const churnData = await hydrateExecutiveSummary({
        $,
        deps,
        roiPrefetchPromise,
        alertsPrefetchPromise,
        summary: dashboard.summary || {},
        branchLabel: app.selectedBranchLabel(),
        branchPerformance: dashboard.branch_performance || [],
        branchId,
        churnDataPromise
      });
      renderChurnList({ $, churnCustomers: churnData?.customers || [], app });
      const anomalies = await api("/api/admin/analytics/anomalies");
      renderValueAnomalies($, anomalies);
      const ledger = await api("/api/admin/analytics/ledger-reconciliation");
      renderLedgerReconciliation($, ledger);
      await loadLedgerCertification({ $, api });
      await loadLedgerCertificationArchive({ $, api });
      await loadLedgerCorrections({ $, api });
      await loadAuditTimeline();
    } catch (error) {
      toast(`Error cargando analítica: ${error.message}`);
    }
  }
  async function recalcAnalytics() {
    try {
      toast("Encolando recalculo... puede tardar unos segundos.");
      const out = await api("/api/admin/analytics/calculate", { method: "POST" });
      const jobId = out?.job?.id;
      if (!jobId) {
        toast("Recalculo encolado.");
        return;
      }
      let done = false;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const jobState = await api(`/api/admin/jobs/${encodeURIComponent(jobId)}`);
        const status = jobState?.job?.status;
        if (status === "DONE") {
          done = true;
          break;
        }
        if (status === "FAILED") {
          throw new Error(jobState?.job?.error || "Fallo el job de analitica");
        }
      }

      toast(done ? "Analitica recalculada." : "Recalculo en proceso; refresca en unos segundos.");
      await loadAnalytics();
    } catch (error) {
      toast(`Error: ${error.message}`);
    }
  }
  function init() {
    ensureLedgerCertificationDates($);
    $("#btnRecalcAnalytics")?.addEventListener("click", () => recalcAnalytics().catch(() => {}));
    $("#btnRefreshLedgerReconciliation")?.addEventListener("click", () => loadAnalytics().catch(() => {}));
    $("#btnRefreshRoi")?.addEventListener("click", () => loadAnalytics().catch(() => {}));
    $("#btnRefreshAlerts")?.addEventListener("click", () => loadAnalytics().catch(() => {}));
    $("#btnRefreshLedgerCertification")?.addEventListener("click", () => loadLedgerCertification({ $, api }).catch((error) => { toast(`Error cargando certificación: ${error.message}`); }));
    $("#btnRefreshLedgerCertificationArchive")?.addEventListener("click", () => loadLedgerCertificationArchive({ $, api }).catch((error) => { toast(`Error cargando archivo de certificación: ${error.message}`); }));
    $("#btnExportLedgerCertificationCsv")?.addEventListener("click", () => exportLedgerCertificationCsv($));
    $("#btnRefreshAnomalies")?.addEventListener("click", () => loadAnalytics().catch(() => {}));
    $("#btnRefreshLedgerCorrections")?.addEventListener("click", () => loadAnalytics().catch(() => {}));
    $("#btnRequestLedgerCorrection")?.addEventListener("click", () => requestLedgerCorrection({ $, api, toast, loadAnalytics }).catch((error) => { toast(`Error solicitando corrección: ${error.message}`); }));
    $("#ledgerCorrectionsList")?.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const applyId = target?.dataset?.correctionApply;
      const rejectId = target?.dataset?.correctionReject;
      if (applyId) {
        applyLedgerCorrection({ api, toast, loadAnalytics }, applyId).catch((error) => { toast(`Error aplicando corrección: ${error.message}`); });
      } else if (rejectId) {
        rejectLedgerCorrection({ api, toast, loadAnalytics }, rejectId).catch((error) => { toast(`Error rechazando corrección: ${error.message}`); });
      }
    });
  }
  return { init, loadAnalytics };
}
