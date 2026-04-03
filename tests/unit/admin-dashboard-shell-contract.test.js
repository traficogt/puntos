import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join(process.cwd(), "public/admin-dashboard.html");
const cssPath = path.join(process.cwd(), "public/styles/admin-dashboard-premium.css");
const corePath = path.join(process.cwd(), "public/admin-dashboard/core.js");

test("admin dashboard shell exposes the premium control deck", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /admin-command-deck/);
  assert.match(html, /id="adminOverviewPlan"/);
  assert.match(html, /id="adminWorkspaceTitle"/);
  assert.match(html, /id="adminStageTitle"/);
  assert.match(html, /id="btnFocusAnalytics"/);
  assert.match(html, /admin-tab-group-label">Programa/);
  assert.match(html, /admin-tab-group-label">Operación/);
  assert.match(html, /admin-tab-group-label">Crecimiento/);
});

test("admin dashboard shell keeps the detailed rail secondary to the executive summary", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  const summaryIndex = html.indexOf("admin-growth-summary");
  const railIndex = html.indexOf("admin-tab-rail");

  assert.notEqual(summaryIndex, -1);
  assert.notEqual(railIndex, -1);
  assert.ok(summaryIndex < railIndex);
});

test("admin dashboard shell loads the premium stylesheet", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");

  assert.match(html, /\/styles\/admin-dashboard-premium\.css/);
  assert.match(css, /\.page-admin \.admin-command-deck/);
  assert.match(css, /\.page-admin \.admin-stage-header/);
});

test("admin dashboard core updates shell chrome from active tab state", () => {
  const core = fs.readFileSync(corePath, "utf8");

  assert.match(core, /const TAB_PRESENTATION =/);
  assert.match(core, /function updateDashboardChrome/);
  assert.match(core, /adminGrowthScope/);
  assert.match(core, /selectedScopeLabel\(\)/);
  assert.match(core, /adminOverviewTab/);
  assert.match(core, /adminStageDesc/);
  assert.match(core, /function focusTab/);
});
