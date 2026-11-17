import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository module paths only.
const read = path => fs.readFile(new URL(path, import.meta.url), "utf8");
const renderStub = data(`const record=name=>(args)=>{globalThis.__race.renders.push([name,args]);return [];};
export const applyLedgerCorrection=()=>{};export const ensureLedgerCertificationDates=()=>{};export const exportLedgerCertificationCsv=()=>{};
export const loadLedgerCertification=async()=>{};export const loadLedgerCertificationArchive=async()=>{};export const loadLedgerCorrections=async()=>{};
export const rejectLedgerCorrection=()=>{};export const requestLedgerCorrection=()=>{};export const renderBranchBenchmark=()=>{};export const renderBranchCompareTable=()=>{};
export const renderBranchPerformance=record('performance');export const renderChurnList=record('churn');export const renderLedgerReconciliation=()=>{};
export const renderRevenueTrend=record('trend');export const renderRfmDistribution=()=>{};export const renderSummaryTiles=record('summary');export const renderValueAnomalies=()=>{};`);
const dashboardSource = (await read("../../public/admin-dashboard/modules/analytics/dashboard.js"))
  .replace('"./cohorts.js"', JSON.stringify(data("export const loadCohortSummary=async()=>{};")))
  .replace('"./executive-summary-loader.js"', JSON.stringify(data("export const hydrateExecutiveSummary=async({churnDataPromise})=>churnDataPromise;")))
  .replace('"./render.js"', JSON.stringify(renderStub));
const { createAnalyticsDashboardController } = await import(data(dashboardSource));
const actionsSource = (await read("../../public/admin-dashboard/modules/program-actions.js"))
  .replace('"/lib.js"', JSON.stringify(data("export const regionalMoney=value=>String(value);")))
  .replace('"./program-form.js"', JSON.stringify(data("export const applyAutomationTemplateForm=()=>{};export const buildProgramPayload=()=>({});export const fillExternalAwardsForm=()=>{};export const fillProgramForm=()=>{};export const toggleProgramBoxes=()=>{};export const updateProgramSummary=()=>{};")));
const { createProgramActions } = await import(data(actionsSource));

/** A fake dashboard whose API responses resolve only when the test releases them. */
function fixture(t) {
  const pending = [], toasts = [], elements = new Map();
  let branch = "branch-a";
  globalThis.__race = { renders: [] };
  t.after(() => { delete globalThis.__race; });
  const app = {
    toast: message => toasts.push(message),
    $: selector => {
      if (!elements.has(selector)) elements.set(selector, { textContent: "", addEventListener() {} });
      return elements.get(selector);
    },
    api: path => new Promise((resolve, reject) => pending.push({ path, resolve, reject })),
    selectedBranchId: () => branch,
    selectedBranchLabel: () => branch,
    branchQueryString: () => (branch ? `branch_id=${branch}` : ""),
    hasFeature: () => true
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  /** Resolves the oldest ("first") or newest ("last") pending request for an exact path. */
  async function respond(path, value, which = "last") {
    const find = () => which === "first"
      ? pending.findIndex(item => item.path === path)
      : pending.map(item => item.path).lastIndexOf(path);
    for (let i = 0; i < 50 && find() < 0; i++) await tick();
    const index = find();
    assert.ok(index >= 0, `request ${path}`);
    const [item] = pending.splice(index, 1);
    item.resolve(value);
    await tick();
  }
  /** Answers every remaining request with an empty body until the loads finish. */
  async function drain(promise) {
    let finished = false;
    promise.then(() => { finished = true; }, () => { finished = true; });
    while (!finished) { for (const item of pending.splice(0)) item.resolve({}); await tick(); }
    return promise;
  }
  return { app, toasts, elements, respond, drain, select: value => { branch = value; } };
}
const dashboardFor = branch => ({ summary: { label: branch }, branch_performance: [], recent_activity: [] });

test("a slower dashboard response for the previous branch never renders under the newer branch", async t => {
  const f = fixture(t);
  const controller = createAnalyticsDashboardController(f.app, {
    loadOpsSummary: async () => {}, loadJobsStatus: async () => {}, loadPaymentPending: async () => {}, loadAuditTimeline: async () => {},
    loadRoiReport: async () => ({}), loadAlertsCenter: async () => ({})
  });
  const first = controller.loadAnalytics();
  f.select("branch-b");
  const second = controller.loadAnalytics();
  // The newer branch answers first; the older branch's responses arrive late.
  await f.respond("/api/admin/analytics/dashboard?branch_id=branch-b", dashboardFor("branch-b"));
  await f.respond("/api/admin/analytics/dashboard", dashboardFor("global"));
  await f.respond("/api/admin/analytics/churn-risk?limit=10&branch_id=branch-b", { customers: [{ id: "b" }] });
  await f.respond("/api/admin/analytics/dashboard?branch_id=branch-a", dashboardFor("branch-a"), "first");
  await f.respond("/api/admin/analytics/dashboard", dashboardFor("global"), "first");
  await f.drain(Promise.all([first, second]));
  const summaries = globalThis.__race.renders.filter(([name]) => name === "summary").map(([, args]) => args.summary.label);
  assert.deepEqual(summaries, ["branch-b"]);
  const churn = globalThis.__race.renders.filter(([name]) => name === "churn").map(([, args]) => args.churnCustomers.map(row => row.id));
  assert.deepEqual(churn, [["b"]]);
  assert.deepEqual(f.toasts, [], "an abandoned load does not report an error");
});

test("suspicious transactions from the previous branch never replace the newer branch list", async t => {
  const f = fixture(t);
  const actions = createProgramActions(/** @type {any} */ (f.app));
  const first = actions.loadSuspiciousAwards();
  f.select("branch-b");
  const second = actions.loadSuspiciousAwards();
  await f.respond("/api/admin/awards/suspicious?limit=30&branch_id=branch-b", { awards: [] });
  await f.respond("/api/admin/awards/suspicious?limit=30&branch_id=branch-a", { awards: [{ created_at: "2026-11-16T10:00:00Z", staff_name: "A", customer_name: "Cliente A", points: 5, amount_q: 10, guard: { reasons: ["amount_threshold"] } }] });
  await Promise.all([first, second]);
  assert.equal(f.elements.get("#suspiciousAwards").textContent, "Sin transacciones sospechosas.");
});
