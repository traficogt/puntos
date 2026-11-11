import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const source = await fs.readFile(new URL("../../public/customer/me.js", import.meta.url), "utf8");
const rendered = data("export const renderRewards=(...a)=>globalThis.__sections.events.push(['rewards',...a]);export const renderHistory=(...a)=>globalThis.__sections.events.push(['history',...a]);export const renderTier=()=>{};export const renderAchievements=()=>{};export const renderReferralCode=()=>{};export const renderReferralStats=()=>{};export const renderOfflineStub=()=>{};");
const mod = source.replace('"/idb.js"', JSON.stringify(data("export const putCustomerCache=(...a)=>globalThis.__sections.writes.push(a);")))
  .replace('"/lib.js"', JSON.stringify(data("export const setHidden=(el,hidden)=>{if(el)el.hidden=hidden;};")))
  .replace('"../customer-branding.js"', JSON.stringify(data("export const applyWalletBranding=()=>({walletHeadline:'Wallet',programName:'Cafe'});")))
  .replace('"./render.js"', JSON.stringify(rendered))
  .replace('"./format.js"', JSON.stringify(new URL("../../public/customer/format.js", import.meta.url).href))
  .replace('"./native-wallet.js"', JSON.stringify(data("export const renderNativeWallet=async()=>{};")))
  .replace('"./statement.js"', JSON.stringify(data("export const renderStatement=(...a)=>globalThis.__sections.events.push(['statement',...a]);")))
  .replace('"./session.js"', JSON.stringify(new URL("../../public/customer/session.js", import.meta.url).href));
const { renderFromMe } = await import(data(mod));
const identity = { businessId: "biz-a", customerId: "customer-a", slug: "cafe" };
const me = { business: { id: identity.businessId, slug: "cafe", features: {} }, customer: { id: identity.customerId, points: 10 } };

function setup(t) {
  const priorDoc = globalThis.document;
  globalThis.document = /** @type {any} */ ({ title: "" });
  const events = [], writes = [];
  globalThis.__sections = { events, writes };
  t.after(() => { globalThis.document = priorDoc; delete globalThis.__sections; });
  const elements = new Map();
  const $ = key => {
    if (!elements.has(key)) elements.set(key, { textContent: "old data", value: "old code", dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, replaceChildren() { this.textContent = ""; } });
    return elements.get(key);
  };
  return { $, toast() {}, identity, events, writes, elements };
}

test("wallet section caches are bound to the verified customer and business", async t => {
  const h = setup(t);
  await renderFromMe({ ...h, api: async () => ({ rewards: [], transactions: [], redemptions: [], tier: null }) }, me, true);
  assert.ok(h.writes.length > 0);
  assert.ok(h.writes.every(write => write[2]?.businessId === identity.businessId && write[2]?.customerId === identity.customerId));
});

test("auth loss in a secondary wallet request propagates to clear the whole wallet", async t => {
  const h = setup(t);
  await assert.rejects(renderFromMe({ ...h, api: async () => { throw Object.assign(new Error("Expired"), { status: 401, code: "AUTH_INVALID_SESSION" }); } }, me, true), /Expired/);
});

test("late section responses cannot render or cache after account invalidation", async t => {
  const h = setup(t);
  let current = true;
  await renderFromMe({ ...h, isCurrent: () => current, api: async () => { current = false; return { rewards: [] }; } }, me, true);
  assert.equal(h.writes.length, 0);
  assert.equal(h.events.length, 0);
});

test("offline snapshots missing history remove the previous customer's activity", async t => {
  const h = setup(t);
  await renderFromMe({ ...h, api: async () => null }, me, false, { sections: { me, rewards: { rewards: [] } } });
  assert.notEqual(h.$("#tx").textContent, "old data");
  assert.notEqual(h.$("#red").textContent, "old data");
});

test('live reward sections pass authoritative progress and its matching balances to the renderer', async t => {
  const h = setup(t), progress = { available_points: 40, pending_points: 100, reward: { name: 'Café original' } };
  await renderFromMe({ ...h, api: async path => path.endsWith('/rewards') ? { rewards: [], progress } : {} }, me, true);
  const event = h.events.find(row => row[0] === 'rewards');
  assert.equal(event?.[4]?.progress, progress);
  assert.equal(event?.[4]?.isLive, true);
  assert.equal(h.$('#points').textContent, '40');
  assert.equal(h.$('#pendingPoints').textContent, '100');
});

test('cached reward targets are explicitly rendered as saved data', async t => {
  const h = setup(t), progress = { available_points: 20, pending_points: 50, reward: null };
  await renderFromMe({ ...h, api: async () => { throw new Error('Network'); } }, me, true, { sections: { rewards: { rewards: [], progress } } });
  assert.equal(h.events.find(row => row[0] === 'rewards')?.[4]?.isLive, false);
});

test('customer statement uses identity-scoped cache and labels cached responses stale', async t => {
  const h = setup(t), statement = { points: { earned: 20 } };
  await renderFromMe({ ...h, api: async path => path.endsWith('/statement') ? { statement } : {} }, me, true);
  const saved = h.writes.find(row => row[0] === 'statement');
  assert.deepEqual(saved[2], identity);
  assert.equal(h.events.find(row => row[0] === 'statement')[3].isLive, true);
  h.events.length = 0;
  await renderFromMe({ ...h, api: async () => { throw new Error('Network'); } }, me, true, { sections: { statement: { statement } } });
  assert.equal(h.events.find(row => row[0] === 'statement')[3].isLive, false);
});
