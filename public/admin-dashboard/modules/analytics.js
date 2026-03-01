import { createAnalyticsAuditController } from "./analytics/audit.js";
import { createAnalyticsOperationsController } from "./analytics/operations.js";
import { createAnalyticsDashboardController } from "./analytics/dashboard.js";

/** @typedef {import("../types.js").AdminDashboardApp} AdminDashboardApp */
/** @typedef {import("../types.js").AnalyticsDashboardDeps} AnalyticsDashboardDeps */
/** @typedef {import("../types.js").AnalyticsModuleControllers} AnalyticsModuleControllers */

/**
 * @param {AdminDashboardApp} app
 */
export function registerAnalyticsModule(app) {
  const audit = createAnalyticsAuditController(app);
  const operations = createAnalyticsOperationsController(app);
  /** @type {AnalyticsDashboardDeps} */
  const deps = {
    loadOpsSummary: operations.loadOpsSummary,
    loadRoiReport: operations.loadRoiReport,
    loadJobsStatus: operations.loadJobsStatus,
    loadPaymentPending: operations.loadPaymentPending,
    loadAlertsCenter: operations.loadAlertsCenter,
    loadAuditTimeline: audit.loadAuditTimeline
  };
  const dashboard = createAnalyticsDashboardController(app, deps);
  /** @type {AnalyticsModuleControllers} */
  const controllers = { audit, operations, dashboard };

  app.onAfterPlanReady(() => {
    controllers.operations.init();
    controllers.audit.init();
    controllers.dashboard.init();
  });

  app.onBranchFilterChanged(() => {
    if (!app.hasFeature("analytics")) return;
    controllers.dashboard.loadAnalytics().catch(() => {});
  });

  app.registerTab("analytics", {
    feature: "analytics",
    allowManager: false,
    load: controllers.dashboard.loadAnalytics
  });
}
