import test from "node:test";
import assert from "node:assert/strict";

import { summarizeCohortRetention } from "../../public/admin-dashboard/modules/analytics/cohorts.js";

test("cohort summary reads the API month rows and keeps unfinished months distinct from zero", () => {
  const rows = [
    { cohort_date: "2026-08-01T00:00:00.000Z", month_number: 0, retention_rate: "100.00" },
    { cohort_date: "2026-08-01T00:00:00.000Z", month_number: 1, retention_rate: "33.33" },
    { cohort_date: "2026-08-01T00:00:00.000Z", month_number: 2, retention_rate: "0.00" },
    { cohort_date: "2026-08-01T00:00:00.000Z", month_number: 3, retention_rate: null },
    { cohort_date: "2026-07-01T00:00:00.000Z", month_number: 1, retention_rate: "50.00" }
  ];
  const summary = summarizeCohortRetention(rows);
  assert.deepEqual(summary.map((cohort) => cohort.cohortMonth), ["2026-08-01", "2026-07-01"]);
  assert.equal(summary[0].rates.get(1), 33.33);
  assert.equal(summary[0].rates.get(2), 0);
  assert.equal(summary[0].rates.get(3), null);
  assert.equal(summary[1].rates.get(1), 50);
});
