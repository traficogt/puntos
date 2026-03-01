import { loadCohortHeatmap } from "./cohorts.js";
import {
  renderBranchBenchmark,
  renderBranchCompareTable,
  renderBranchPerformance,
  renderChurnList,
  renderRevenueTrend,
  renderRfmDistribution,
  renderSummaryTiles
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
    loadRoiReport,
    loadJobsStatus,
    loadPaymentPending,
    loadAlertsCenter,
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

      renderSummaryTiles({ $, summary: dashboard.summary || {}, app });
      renderRfmDistribution({ $, dashboard, app });
      const activityRows = renderRevenueTrend({ $, dashboard, app });

      const churnData = await api(`/api/admin/analytics/churn-risk?limit=10${query ? `&${query}` : ""}`);
      renderChurnList({ $, churnCustomers: churnData.customers || [], app });

      const perfRows = renderBranchPerformance({ $, dashboard, app });
      renderBranchCompareTable($, perfRows);
      await loadCohortHeatmap({ $, api });

      const benchmarkBranchRows = branchId ? activityRows : [];
      const benchmarkGlobalRows = branchId ? (globalDashboard?.recent_activity || []) : activityRows;
      renderBranchBenchmark($, {
        branchRows: benchmarkBranchRows,
        globalRows: benchmarkGlobalRows,
        branchLabel: app.selectedBranchLabel()
      });

      await loadOpsSummary();
      await loadRoiReport();
      await loadJobsStatus();
      await loadPaymentPending();
      await loadAlertsCenter();
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
    $("#btnRecalcAnalytics")?.addEventListener("click", () => recalcAnalytics().catch(() => {}));
  }

  return {
    init,
    loadAnalytics
  };
}
