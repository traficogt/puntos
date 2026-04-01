import { loadCohortSummary } from "./cohorts.js";
import {
  renderBranchBenchmark,
  renderBranchCompareTable,
  renderLedgerCertification,
  renderLedgerCertificationArchive,
  renderBranchPerformance,
  renderChurnList,
  renderLedgerCorrections,
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
    loadRoiReport,
    loadJobsStatus,
    loadPaymentPending,
    loadAlertsCenter,
    loadAuditTimeline
  } = deps;

  async function loadLedgerCorrections() {
    const corrections = await api("/api/admin/analytics/ledger-corrections");
    renderLedgerCorrections($, corrections);
  }

  function defaultCertificationDates() {
    const fromEl = $("#ledgerCertificationFrom");
    const toEl = $("#ledgerCertificationTo");
    if (!fromEl || !toEl) return;
    if (fromEl.value && toEl.value) return;
    const end = new Date();
    const to = end.toISOString().slice(0, 10);
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    const from = start.toISOString().slice(0, 10);
    if (!fromEl.value) fromEl.value = from;
    if (!toEl.value) toEl.value = to;
  }

  async function loadLedgerCertification() {
    defaultCertificationDates();
    const params = new URLSearchParams();
    const from = $("#ledgerCertificationFrom")?.value;
    const to = $("#ledgerCertificationTo")?.value;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const query = params.toString();
    const certification = await api(`/api/admin/analytics/ledger-certification${query ? `?${query}` : ""}`);
    renderLedgerCertification($, certification);
  }

  async function loadLedgerCertificationArchive() {
    const archive = await api("/api/admin/analytics/ledger-certification/archive");
    renderLedgerCertificationArchive($, archive);
  }

  function exportLedgerCertificationCsv() {
    defaultCertificationDates();
    const params = new URLSearchParams();
    const from = $("#ledgerCertificationFrom")?.value;
    const to = $("#ledgerCertificationTo")?.value;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const query = params.toString();
    window.open(`/api/admin/analytics/ledger-certification.csv${query ? `?${query}` : ""}`, "_blank");
  }

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
      await loadCohortSummary({ $, api });

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
      const anomalies = await api("/api/admin/analytics/anomalies");
      renderValueAnomalies($, anomalies);
      const ledger = await api("/api/admin/analytics/ledger-reconciliation");
      renderLedgerReconciliation($, ledger);
      await loadLedgerCertification();
      await loadLedgerCertificationArchive();
      await loadLedgerCorrections();
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

  async function requestLedgerCorrection() {
    const customerId = $("#ledgerCorrectionCustomerId")?.value?.trim();
    const reason = $("#ledgerCorrectionReason")?.value?.trim();
    if (!customerId || !reason) {
      toast("Ingresa customer ID y razón.");
      return;
    }
    await api("/api/admin/analytics/ledger-corrections", {
      method: "POST",
      body: JSON.stringify({ customerId, reason })
    });
    $("#ledgerCorrectionCustomerId").value = "";
    $("#ledgerCorrectionReason").value = "";
    toast("Corrección solicitada.");
    await loadAnalytics();
  }

  async function applyLedgerCorrection(correctionId) {
    await api(`/api/admin/analytics/ledger-corrections/${encodeURIComponent(correctionId)}/apply`, {
      method: "POST",
      body: "{}"
    });
    toast("Corrección aplicada.");
    await loadAnalytics();
  }

  async function rejectLedgerCorrection(correctionId) {
    const reason = window.prompt("Razón del rechazo de la corrección:");
    if (!reason) return;
    await api(`/api/admin/analytics/ledger-corrections/${encodeURIComponent(correctionId)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });
    toast("Corrección rechazada.");
    await loadAnalytics();
  }

  function init() {
    defaultCertificationDates();
    $("#btnRecalcAnalytics")?.addEventListener("click", () => recalcAnalytics().catch(() => {}));
    $("#btnRefreshLedgerReconciliation")?.addEventListener("click", () => loadAnalytics().catch(() => {}));
    $("#btnRefreshLedgerCertification")?.addEventListener("click", () => loadLedgerCertification().catch((error) => {
      toast(`Error cargando certificación: ${error.message}`);
    }));
    $("#btnRefreshLedgerCertificationArchive")?.addEventListener("click", () => loadLedgerCertificationArchive().catch((error) => {
      toast(`Error cargando archivo de certificación: ${error.message}`);
    }));
    $("#btnExportLedgerCertificationCsv")?.addEventListener("click", exportLedgerCertificationCsv);
    $("#btnRefreshAnomalies")?.addEventListener("click", () => loadAnalytics().catch(() => {}));
    $("#btnRefreshLedgerCorrections")?.addEventListener("click", () => loadAnalytics().catch(() => {}));
    $("#btnRequestLedgerCorrection")?.addEventListener("click", () => requestLedgerCorrection().catch((error) => {
      toast(`Error solicitando corrección: ${error.message}`);
    }));
    $("#ledgerCorrectionsList")?.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const applyId = target?.dataset?.correctionApply;
      const rejectId = target?.dataset?.correctionReject;
      if (applyId) {
        applyLedgerCorrection(applyId).catch((error) => {
          toast(`Error aplicando corrección: ${error.message}`);
        });
      } else if (rejectId) {
        rejectLedgerCorrection(rejectId).catch((error) => {
          toast(`Error rechazando corrección: ${error.message}`);
        });
      }
    });
  }

  return {
    init,
    loadAnalytics
  };
}
