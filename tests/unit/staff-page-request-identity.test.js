import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Runs the real staff page module with fake DOM, storage and API boundaries.
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const source = await fs.readFile(new URL("../../public/staff/index.js", import.meta.url), "utf8");
const idbStub = `
const rows = () => globalThis.__staffPage.rows;
const inScope = (row, scope) => Boolean(scope?.businessId && scope?.staffId && row?.businessId === scope.businessId && row?.staffId === scope.staffId);
export async function addAward(award) { if (rows().has(award.txId)) throw new Error("ConstraintError"); rows().set(award.txId, { ...award, status: award.status || "queued", retry_count: Number(award.retry_count || 0), last_error: String(award.last_error || ""), created_at: new Date().toISOString() }); }
export async function updateAward(txId, patch, scope) { const row = rows().get(txId); if (!inScope(row, scope)) return null; for (const key of ["status", "retry_count", "last_error"]) if (patch[key] !== undefined) row[key] = patch[key]; return row; }
export async function listAwards(options = {}) { return [...rows().values()].filter(row => inScope(row, options) && (!options.statuses || options.statuses.includes(row.status || "queued"))); }
export async function deleteAward(txId, scope) { if (inScope(rows().get(txId), scope)) rows().delete(txId); }
export async function requeueSyncingAwards(scope) { for (const row of await listAwards({ ...scope, statuses: ["syncing"] })) row.status = "queued"; }
export async function getAwardQueueStats(scope) {
  const awards = await listAwards(scope || {});
  const stats = { total: awards.length, queued: 0, syncing: 0, failed: 0, held: 0, rejected: 0, quarantined: 0, lastQueuedAt: "", lastError: "" };
  for (const row of awards) {
    if (row.status === "syncing") stats.syncing++;
    else if (row.status === "held" || row.status === "failed") { stats.held++; stats.failed++; }
    else if (row.status === "rejected") { stats.rejected++; stats.failed++; }
    else stats.queued++;
  }
  return stats;
}`;
const destroyable = "({destroy(){},contextChanged(){},showRedemption(){},showCase(){}})";
const { initStaffPage } = await import(data(source
  .replace('"./reward-entitlements.js"', JSON.stringify(data(`export const mountRewardEntitlements=()=>${destroyable};`)))
  .replace('"./pos-recording.js"', JSON.stringify(data(`export const mountPosRecording=()=>${destroyable};`)))
  .replace('"/idb.js"', JSON.stringify(data(idbStub)))
  .replace('"/lib.js"', JSON.stringify(data("export const registerServiceWorker=async()=>{};export const setHidden=(el,hidden)=>{if(el)el.hidden=hidden;};")))
  .replace('"./award-queue.js"', JSON.stringify(new URL("../../public/staff/award-queue.js", import.meta.url).href))
  .replace('"./service-cases.js"', JSON.stringify(data(`export const mountServiceCases=()=>${destroyable};`)))
  .replace('"../demand-notebook.js"', JSON.stringify(data(`export const mountDemandNotebook=()=>${destroyable};`)))
  .replace('"./owner-operations.js"', JSON.stringify(data("export const mountOwnerOperations=()=>{};")))
  .replace('"./service-briefing.js"', JSON.stringify(data(`export const mountServiceBriefing=()=>${destroyable};`)))));

function fakeElement() {
  return {
    textContent: "", value: "", disabled: false, hidden: false, open: false, type: "", className: "", step: "", min: "",
    dataset: {}, children: [], listeners: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
    replaceChildren(...nodes) { this.children = nodes; },
    appendChild(node) { this.children.push(node); return node; },
    append(...nodes) { this.children.push(...nodes); },
    after() {},
    closest(selector) { return selector === "button[data-queue-action]" && this.dataset.queueAction ? this : null; }
  };
}
const flatten = node => [node, ...node.children.flatMap(flatten)];

/** @param {import("node:test").TestContext} t @param {(path: string, body: any) => any} handler @param {Record<string, unknown>} [staffPatch] */
async function openPage(t, handler, staffPatch = {}) {
  const elements = {}, saved = new Map(), messages = [], calls = [];
  const state = { rows: new Map() };
  for (const [key, value] of Object.entries({
    __staffPage: state,
    navigator: { onLine: true },
    location: { href: "" },
    window: { addEventListener() {} },
    document: { hidden: false, addEventListener() {}, createElement: () => fakeElement() },
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)), removeItem: k => saved.delete(k) }
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, "setInterval", /** @type {any} */ (() => 1));
  const api = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body });
    if (path === "/api/staff/me") return { staff: { id: "staff-a", business_id: "business-a", role: "OWNER", can_manage_gift_cards: true, branch_id: null, ...staffPatch }, features: { redemptions: true, gift_cards: true } };
    if (path === "/api/staff/permissions") return { matrix: { OWNER: ["staff.award", "staff.sync", "staff.redeem"] } };
    if (path === "/api/staff/program") return { program_type: "SPEND", program_json: { points_per_q: 1 } };
    if (path === "/api/staff/offline-grant") return { grant: "server-signed-offline-grant", expiresAt: new Date(Date.now() + 86400000).toISOString() };
    if (path === "/api/staff/rewards") return { rewards: [{ id: "reward-a", name: "Café", points_cost: 20 }, { id: "reward-b", name: "Pan", points_cost: 30 }] };
    if (path === "/api/staff/customer/lookup") return { customer: { id: "customer-a", name: "Cliente", points: 100 } };
    return handler(path, body);
  };
  const $ = selector => elements[selector] ||= fakeElement();
  await initStaffPage({ api, $, toast: text => messages.push(text), uuidv4: () => crypto.randomUUID() });
  const fire = async (selector, event = {}) => { for (const listener of $(selector).listeners.click || []) await listener(event); };
  return { $, calls, messages, state, fire, requests: path => calls.filter(call => call.path === path) };
}

async function selectCustomer(page) {
  page.$("#token").value = "signed-qr-token";
  await page.fire("#btnSelectCustomer");
  assert.equal(page.$("#lastCustomer").textContent, "customer-a");
}

test("a redemption retried after a lost response keeps its request ID until confirmed or changed", async t => {
  let outcomes = [new TypeError("Failed to fetch"), new TypeError("Failed to fetch")];
  const page = await openPage(t, (path) => {
    if (path !== "/api/staff/redeem") return { results: [] };
    const failure = outcomes.shift();
    if (failure) throw failure;
    return { redemptionCode: "ABC123", newBalance: 70 };
  });
  await selectCustomer(page);
  page.$("#rewardSelect").value = "reward-a";
  await page.fire("#btnRedeem");
  await page.fire("#btnRedeem");
  const [first, second] = page.requests("/api/staff/redeem").map(call => call.body);
  assert.equal(second.requestId, first.requestId, "a second click after a lost response must not create a second deduction");
  page.$("#rewardSelect").value = "reward-b";
  await page.fire("#btnRedeem");
  const changed = page.requests("/api/staff/redeem")[2].body;
  assert.notEqual(changed.requestId, first.requestId, "a different reward is a new redemption");
  assert.equal(page.$("#redeemCode").textContent, "ABC123");
  outcomes = [];
  await page.fire("#btnRedeem");
  assert.notEqual(page.requests("/api/staff/redeem")[3].body.requestId, changed.requestId, "a confirmed redemption releases its request ID");
});

test("a gift-card charge retried after a lost response keeps its request ID until confirmed or changed", async t => {
  let outcomes = [new TypeError("Failed to fetch"), Object.assign(new Error("Error interno"), { status: 500 })];
  const page = await openPage(t, (path) => {
    if (path !== "/api/staff/gift-cards/redeem") return { results: [] };
    const failure = outcomes.shift();
    if (failure) throw failure;
    return { gift_card: { balance_q: 90, status: "ACTIVE" } };
  });
  page.$("#giftCode").value = "GC-0001";
  page.$("#giftAmount").value = "10";
  await page.fire("#btnGiftRedeem");
  await page.fire("#btnGiftRedeem");
  const [first, second] = page.requests("/api/staff/gift-cards/redeem").map(call => call.body);
  assert.equal(second.requestId, first.requestId);
  page.$("#giftAmount").value = "12";
  await page.fire("#btnGiftRedeem");
  const changed = page.requests("/api/staff/gift-cards/redeem")[2].body;
  assert.notEqual(changed.requestId, first.requestId);
  assert.match(page.$("#giftStatus").textContent, /Saldo restante/);
  await page.fire("#btnGiftRedeem");
  assert.notEqual(page.requests("/api/staff/gift-cards/redeem")[3].body.requestId, changed.requestId);
});

test("a rejected online sale is reported as not registered and can be discarded without replay", async t => {
  const page = await openPage(t, (path, body) => {
    if (path === "/api/staff/award") throw Object.assign(new Error("Límite de puntos por compra excedido"), { status: 400 });
    if (path === "/api/staff/sync") return { results: body.awards.map(({ txId }) => ({ txId, ok: true })) };
    return {};
  });
  await selectCustomer(page);
  page.$("#amount").value = "25";
  await page.fire("#btnAward");
  assert.match(page.messages.at(-1), /^No se registró: Límite de puntos por compra excedido\. Esta venta no se reintentará/);
  const [row] = page.state.rows.values();
  assert.equal(row.status, "rejected");
  assert.match(page.$("#queueMeta").textContent, /Rechazadas: 1/);
  assert.equal(page.$("#queueDetails").open, true, "rows needing attention open the queue");
  await page.fire("#btnSync");
  assert.equal(page.requests("/api/staff/sync").length, 0, "rejected sales are not resent");
  const buttons = flatten(page.$("#queueList")).filter(node => node.dataset?.queueAction);
  assert.deepEqual(buttons.map(button => [button.textContent, button.dataset.queueAction]), [["Descartar", "discard"]]);
  for (const listener of page.$("#queueList").listeners.click) await listener({ target: buttons[0] });
  assert.equal(page.state.rows.size, 0);
  assert.equal(page.$("#queueList").textContent, "(sin operaciones pendientes)");
});

test("a sale refused for an expired session waits for an explicit retry with its original transaction ID", async t => {
  let expired = true;
  const page = await openPage(t, (path, body) => {
    if (path === "/api/staff/award" && expired) throw Object.assign(new Error("No autenticado"), { status: 401 });
    if (path === "/api/staff/sync") return { results: body.awards.map(({ txId }) => ({ txId, ok: true })) };
    return {};
  });
  await selectCustomer(page);
  page.$("#amount").value = "25";
  await page.fire("#btnAward");
  assert.match(page.messages.at(-1), /Reintentar o Descartar/);
  const [row] = page.state.rows.values();
  assert.equal(row.status, "held");
  expired = false;
  await page.fire("#btnSync");
  assert.equal(page.requests("/api/staff/sync").length, 0, "held sales are never replayed silently");
  const retry = flatten(page.$("#queueList")).find(node => node.dataset?.queueAction === "retry");
  assert.ok(retry);
  for (const listener of page.$("#queueList").listeners.click) await listener({ target: retry });
  const [sent] = page.requests("/api/staff/sync");
  assert.equal(sent.body.awards[0].txId, row.txId);
  assert.equal(page.state.rows.size, 0);
});

const OWN_SESSION_ONLY = "Esta acción de seguridad solo puede hacerse desde la sesión propia de la persona usuaria.";
const SECURITY_CONTROLS = ["#staffReauthPassword", "#staffReauthMfaCode", "#btnStaffReauth", "#btnStaffMfaEnroll", "#btnStaffMfaDisable", "#staffMfaConfirmCode", "#btnStaffMfaConfirm", "#btnStaffLockdown"];

test("a platform support session explains that account security needs the holder's own session", async t => {
  const page = await openPage(t, () => ({}), { impersonated_by: "soporte@example.invalid" });
  assert.deepEqual(SECURITY_CONTROLS.filter(selector => !page.$(selector).disabled), [], "no re-authentication or MFA control is offered");
  assert.equal(page.$("#staffSecurityNotice").hidden, false);
  assert.equal(page.$("#staffSecurityNotice").textContent, OWN_SESSION_ONLY);
});

test("an account-security request refused for impersonation shows the own-session message", async t => {
  const page = await openPage(t, path => {
    if (path === "/api/staff/security/reauth") throw Object.assign(new Error(`${OWN_SESSION_ONLY} (Ref: req-1)`), { status: 403, code: "IMPERSONATION_FORBIDDEN" });
    return {};
  });
  assert.equal(page.$("#btnStaffReauth").disabled, false);
  assert.equal(page.$("#staffSecurityNotice").hidden, true);
  page.$("#staffReauthPassword").value = "contraseña";
  await page.fire("#btnStaffReauth");
  assert.equal(page.messages.at(-1), OWN_SESSION_ONLY);
  assert.equal(page.$("#staffSecurityNotice").textContent, OWN_SESSION_ONLY);
  assert.deepEqual(SECURITY_CONTROLS.filter(selector => !page.$(selector).disabled), []);
});
