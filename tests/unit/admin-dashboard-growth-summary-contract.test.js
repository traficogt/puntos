import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join(process.cwd(), "public/admin-dashboard.html");
const analyticsDashboardPath = path.join(process.cwd(), "public/admin-dashboard/modules/analytics/dashboard.js");
const executiveSummaryPath = path.join(process.cwd(), "public/admin-dashboard/modules/analytics/executive-summary.js");

test("admin dashboard exposes a growth-first executive summary layer", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /admin-growth-summary/);
  assert.match(html, /id="adminGrowthBoard"/);
  assert.match(html, /id="adminExecutiveNarrative"/);
  assert.match(html, /id="adminSuggestedActions"/);
});

test("analytics dashboard delegates executive summary rendering to a dedicated module", () => {
  const dashboardJs = fs.readFileSync(analyticsDashboardPath, "utf8");
  const summaryJs = fs.readFileSync(executiveSummaryPath, "utf8");

  assert.match(dashboardJs, /import\s*\{\s*renderExecutiveSummary\s*\}\s*from\s*["']\.\/executive-summary\.js["']/);
  assert.match(dashboardJs, /renderExecutiveSummary\s*\(/);
  assert.match(dashboardJs, /loadRoiReport\s*\(\s*roiReport\s*\)/);
  assert.match(dashboardJs, /loadAlertsCenter\s*\(\s*alertsCenter\s*\)/);
  assert.match(summaryJs, /export function renderExecutiveSummary/);
  assert.match(summaryJs, /adminExecutiveNarrative/);
  assert.match(summaryJs, /adminSuggestedActions/);
});

test("executive summary keeps ROI or cost semantics separate from attributed revenue growth", () => {
  const summaryJs = fs.readFileSync(executiveSummaryPath, "utf8");

  assert.doesNotMatch(summaryJs, /setText\(\$, "#adminKpiRoi", formatSignedPercent\(metrics\.roiGrowth\)\)/);
  assert.match(summaryJs, /setText\(\$, "#adminKpiAttributedRevenueDelta", metrics\.roiGrowth !== null/);
});
