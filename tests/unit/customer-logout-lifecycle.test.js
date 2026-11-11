import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const source = await fs.readFile(new URL("../../public/customer/index.js", import.meta.url), "utf8");
const { initCustomerPage } = await import(data(source
  .replace('"./reward-entitlements.js"', JSON.stringify(data("export const clearRewardEntitlements=()=>{};")))
  .replace('"./growth-offers.js"', JSON.stringify(data("export const clearGrowthOffers=()=>{};")))
  .replace('"/idb.js"', JSON.stringify(data("export const clearCustomerCache=async()=>{globalThis.__logout.clears++;};")))
  .replace('"./load.js"', JSON.stringify(data("export const loadAll=async()=>({status:'live'});")))
  .replace('"./network.js"', JSON.stringify(data("export const setOnlineBadge=()=>{};")))
  .replace('"./qr.js"', JSON.stringify(data("export const createQrController=()=>({generateQR:async()=>{},dispose:()=>{globalThis.__logout.disposed++;}});")))
  .replace('"/lib.js"', JSON.stringify(data("export const registerServiceWorker=async()=>{};")))
  .replace('"./session.js"', JSON.stringify(new URL("../../public/customer/session.js", import.meta.url).href))));

async function setup(t, api) {
  const events = {}, elements = {}, messages = [], saved = new Map([["pf_customer_slug", "cafe"]]);
  const state = { disposed: 0, clears: 0 };
  for (const [key, value] of Object.entries({ __logout: state, location: { href: "", reload() {} },
    window: { addEventListener() {}, setInterval: () => 1, clearInterval() {} }, document: { addEventListener() {}, visibilityState: "visible" },
    localStorage: { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) } })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, "setTimeout", /** @type {any} */ (fn => { fn(); return 1; }));
  const $ = key => elements[key] ||= { textContent: "old data", addEventListener: (event, cb) => { events[`${key}:${event}`] = cb; },
    classList: { contains: () => false, toggle() {} }, replaceChildren() { this.textContent = ""; } };
  await initCustomerPage({ api, $, toast: text => messages.push(text), mountIosInstallHint() {}, modalAlert: async () => {} });
  return { state, messages, elements, logout: events["#btnLogout:click"] };
}

test("failed customer logout does not claim success or redirect with an active server cookie", async t => {
  const h = await setup(t, async () => { throw new TypeError("Failed to fetch"); });
  await h.logout();
  assert.ok(!h.messages.includes("Sesión cerrada."));
  assert.equal(location.href, "");
  assert.ok(h.messages.some(message => /cerrar.*sesión|cerrar la sesión/i.test(message)));
});

test("successful logout stops QR renewal and clears rendered private data", async t => {
  const h = await setup(t, async () => ({ ok: true }));
  await h.logout();
  assert.equal(h.state.disposed, 1);
  assert.equal(h.elements["#main"].hidden, true);
  assert.equal(h.elements["#who"].textContent, "");
  assert.equal(h.state.clears, 1);
  assert.match(location.href, /ingresar\/cafe/);
});
