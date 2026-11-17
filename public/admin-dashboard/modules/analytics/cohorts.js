/** @typedef {import("../../types.js").AnalyticsCohortRow} AnalyticsCohortRow */

/**
 * Groups the API's one-row-per-cohort-month retention into one line per cohort.
 * A null rate means the month has not ended yet; it is not a zero.
 * @param {AnalyticsCohortRow[]} rows
 * @returns {{ cohortMonth: string, rates: Map<number, number | null> }[]}
 */
export function summarizeCohortRetention(rows) {
  /** @type {Map<string, { cohortMonth: string, rates: Map<number, number | null> }>} */
  const cohorts = new Map();
  for (const row of rows) {
    const cohortMonth = row.cohort_date ? String(row.cohort_date).slice(0, 10) : "";
    if (!cohortMonth) continue;
    const cohort = cohorts.get(cohortMonth) ?? { cohortMonth, rates: new Map() };
    const rate = row.retention_rate === null || row.retention_rate === undefined ? null : Number(row.retention_rate);
    cohort.rates.set(Number(row.month_number), rate);
    cohorts.set(cohortMonth, cohort);
  }
  return [...cohorts.values()];
}

/** @param {number | null | undefined} rate */
function formatRate(rate) {
  return rate === null || rate === undefined || !Number.isFinite(rate) ? "en curso" : `${rate.toFixed(0)}%`;
}

/**
 * @param {{ $: (selector: string) => HTMLElement | null; api: (path: string, opts?: RequestInit) => Promise<any> }} args
 */
export async function loadCohortSummary({ $, api }) {
  const box = $("#cohortHeatmap");
  if (!box) return;
  try {
    const out = await api("/api/admin/analytics/cohorts?months=12");
    const cohorts = summarizeCohortRetention(/** @type {AnalyticsCohortRow[]} */ (out.cohorts || []));
    box.replaceChildren();
    if (!cohorts.length) {
      box.textContent = "(sin datos)";
      return;
    }

    cohorts.slice(0, 8).forEach((cohort) => {
      const line = document.createElement("div");
      line.className = "small";
      line.textContent = `${cohort.cohortMonth}: retención m1=${formatRate(cohort.rates.get(1))} m2=${formatRate(cohort.rates.get(2))} m3=${formatRate(cohort.rates.get(3))}`;
      box.appendChild(line);
    });
  } catch (error) {
    box.textContent = `Error cargando cohortes: ${error.message}`;
  }
}
