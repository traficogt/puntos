/**
 * @typedef {import("../../types.js").AdminDashboardApp} AdminDashboardApp
 */

import { renderExecutiveSummary } from "./executive-summary.js";

/**
 * Orchestrates the growth summary data path so the dashboard controller stays thin.
 *
 * @param {{
 *   $: AdminDashboardApp["$"],
 *   deps: Pick<import("../../types.js").AnalyticsDashboardDeps, "loadRoiReport" | "loadAlertsCenter">,
 *   roiPrefetchPromise: Promise<{ roi?: Record<string, unknown> } | null>,
 *   alertsPrefetchPromise: Promise<{ alerts?: Array<Record<string, unknown>> } | null>,
 *   summary: Record<string, unknown>,
 *   branchLabel: string,
 *   branchPerformance: Array<Record<string, unknown>>,
 *   branchId: string | null,
 *   churnDataPromise: Promise<{ count?: number; customers?: import("../../types.js").AnalyticsChurnCustomer[] } | null>
 * }} params
 * @returns {Promise<{ count?: number; customers?: import("../../types.js").AnalyticsChurnCustomer[] } | null>}
 */
export async function hydrateExecutiveSummary({
  $,
  deps,
  roiPrefetchPromise,
  alertsPrefetchPromise,
  summary,
  branchLabel,
  branchPerformance,
  branchId,
  churnDataPromise,
}) {
  const { loadRoiReport, loadAlertsCenter } = deps;
  const [roiPrefetch, alertsPrefetch] = await Promise.allSettled([
    roiPrefetchPromise,
    alertsPrefetchPromise,
  ]);

  const [roiReport, alertsCenter, churnData] = await Promise.all([
    loadRoiReport(roiPrefetch.status === "fulfilled" ? roiPrefetch.value : undefined),
    loadAlertsCenter(alertsPrefetch.status === "fulfilled" ? alertsPrefetch.value : undefined),
    churnDataPromise,
  ]);

  renderExecutiveSummary({
    $,
    summary,
    roiReport,
    churnData,
    alertsCenter,
    branchLabel,
    branchPerformance,
    branchId,
  });

  return churnData;
}
