/**
 * @typedef {import("../../types.js").AdminDashboardApp} AdminDashboardApp
 */

import { renderExecutiveSummary } from "./executive-summary.js";

/**
 * Orchestrates the growth summary data path so the dashboard controller stays thin.
 *
 * @param {{
 *   $: AdminDashboardApp["$"],
 *   api: AdminDashboardApp["api"],
 *   deps: {
 *     loadRoiReport: (prefetched?: unknown) => Promise<unknown>,
 *     loadAlertsCenter: (prefetched?: unknown) => Promise<unknown>
 *   },
 *   summary: Record<string, unknown>,
 *   branchLabel: string,
 *   branchPerformance: Array<Record<string, unknown>>,
 *   branchId: string | null,
 *   churnDataPromise: Promise<{ count?: number; customers?: Array<unknown> } | null>
 * }} params
 * @returns {Promise<{ count?: number; customers?: Array<unknown> } | null>}
 */
export async function hydrateExecutiveSummary({
  $,
  api,
  deps,
  summary,
  branchLabel,
  branchPerformance,
  branchId,
  churnDataPromise
}) {
  const { loadRoiReport, loadAlertsCenter } = deps;
  const [roiPrefetch, alertsPrefetch] = await Promise.allSettled([
    api("/api/admin/roi?days=30"),
    api("/api/admin/alerts?limit=60")
  ]);

  const [roiReport, alertsCenter, churnData] = await Promise.all([
    loadRoiReport(roiPrefetch.status === "fulfilled" ? roiPrefetch.value : undefined),
    loadAlertsCenter(alertsPrefetch.status === "fulfilled" ? alertsPrefetch.value : undefined),
    churnDataPromise
  ]);

  renderExecutiveSummary({
    $,
    summary,
    roiReport,
    churnData,
    alertsCenter,
    branchLabel,
    branchPerformance,
    branchId
  });

  return churnData;
}
