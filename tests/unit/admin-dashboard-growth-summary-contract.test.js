import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join(process.cwd(), "public/admin-dashboard.html");
const analyticsDashboardPath = path.join(process.cwd(), "public/admin-dashboard/modules/analytics/dashboard.js");
const executiveSummaryPath = path.join(process.cwd(), "public/admin-dashboard/modules/analytics/executive-summary.js");
const analyticsOperationsPath = path.join(process.cwd(), "public/admin-dashboard/modules/analytics/operations.js");

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
  const operationsJs = fs.readFileSync(analyticsOperationsPath, "utf8");

  assert.match(dashboardJs, /import\s*\{\s*renderExecutiveSummary\s*\}\s*from\s*["']\.\/executive-summary\.js["']/);
  assert.match(dashboardJs, /renderExecutiveSummary\s*\(/);
  assert.match(dashboardJs, /Promise\.allSettled/);
  assert.match(dashboardJs, /const roiReport = await loadRoiReport/);
  assert.match(dashboardJs, /const alertsCenter = await loadAlertsCenter/);
  assert.match(dashboardJs, /#btnRefreshRoi"\)\?\.addEventListener\("click", \(\) => loadAnalytics\(\)\.catch\(\(\) => \{\}\)\)/);
  assert.match(dashboardJs, /#btnRefreshAlerts"\)\?\.addEventListener\("click", \(\) => loadAnalytics\(\)\.catch\(\(\) => \{\}\)\)/);
  assert.match(operationsJs, /async function loadRoiReport\(prefetched\)/);
  assert.match(operationsJs, /async function loadAlertsCenter\(prefetched\)/);
  assert.match(operationsJs, /return out;/);
  assert.match(summaryJs, /export function renderExecutiveSummary/);
  assert.match(summaryJs, /adminExecutiveNarrative/);
  assert.match(summaryJs, /adminSuggestedActions/);
});

test("executive summary keeps ROI or cost semantics separate from attributed revenue growth", () => {
  const summaryJs = fs.readFileSync(executiveSummaryPath, "utf8");

  assert.doesNotMatch(summaryJs, /setText\(\$, "#adminKpiRoi", formatSignedPercent\(metrics\.roiGrowth\)\)/);
  assert.match(summaryJs, /setText\(\$, "#adminKpiAttributedRevenueDelta", metrics\.roiGrowth !== null/);
});

test("executive summary avoids top-branch fallbacks and qualifies global branch-mode actions", () => {
  const summaryJs = fs.readFileSync(executiveSummaryPath, "utf8");

  assert.doesNotMatch(summaryJs, /roi\.customers_active \|\| branchRow\?\.active_customers_30d/);
  assert.doesNotMatch(summaryJs, /roi\.revenue_current_q \|\| branchRow\?\.revenue_30d/);
  assert.match(summaryJs, /referencia global/);
});
