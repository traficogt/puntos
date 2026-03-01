/** @typedef {import("../../types.js").AnalyticsCohortRow} AnalyticsCohortRow */

/**
 * @param {{ $: (selector: string) => HTMLElement | null; api: (path: string, opts?: RequestInit) => Promise<any> }} args
 */
export async function loadCohortHeatmap({ $, api }) {
  const box = $("#cohortHeatmap");
  if (!box) return;
  try {
    const out = await api("/api/admin/analytics/cohorts?months=12");
    const cohorts = /** @type {AnalyticsCohortRow[]} */ (out.cohorts || []);
    box.replaceChildren();
    if (!cohorts.length) {
      box.textContent = "(sin datos)";
      return;
    }

    cohorts.slice(0, 8).forEach((cohort) => {
      const line = document.createElement("div");
      line.className = "small";
      const month = cohort.cohort_month ? String(cohort.cohort_month).slice(0, 10) : "—";
      line.textContent = `${month}: retención m1=${Number(cohort.m1 || 0).toFixed(0)}% m2=${Number(cohort.m2 || 0).toFixed(0)}% m3=${Number(cohort.m3 || 0).toFixed(0)}%`;
      box.appendChild(line);
    });
  } catch (error) {
    box.textContent = `Error cargando cohortes: ${error.message}`;
  }
}
