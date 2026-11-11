import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const idbStub = dataModule("export const clearCustomerCache=(...a)=>globalThis.__wallet.clear(...a);export const getCustomerCacheSnapshot=(...a)=>globalThis.__wallet.read(...a);export const putCustomerCache=(...a)=>globalThis.__wallet.write(...a);");
const libStub = dataModule("export const setHidden=(el,hidden)=>{if(el)el.hidden=hidden;};");
const meStub = dataModule("export const renderFromMe=(...args)=>globalThis.__wallet.render(...args);");
const networkStub = dataModule("export const setOnlineBadge=()=>{};");
const sessionUrl = new URL("../../public/customer/session.js", import.meta.url).href;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const source = await fs.readFile(new URL("../../public/customer/load.js", import.meta.url), "utf8");
// Load the real offer renderer with the same browser-lib adapter as the wallet loader.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository source URL.
const growthSource = await fs.readFile(new URL("../../public/customer/growth-offers.js", import.meta.url), "utf8");
const growthModule = dataModule(growthSource.replace("'/lib.js'", JSON.stringify(libStub)).replace("'./session.js'", JSON.stringify(sessionUrl)));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository source URL.
const entitlementSource = await fs.readFile(new URL("../../public/customer/reward-entitlements.js", import.meta.url), "utf8");
const entitlementModule = dataModule(entitlementSource.replace("'/lib.js'", JSON.stringify(libStub)).replace("'./session.js'", JSON.stringify(sessionUrl)));
const { loadAll } = await import(dataModule(source.replace('"./reward-entitlements.js"', JSON.stringify(entitlementModule)).replace('"./growth-offers.js"', JSON.stringify(growthModule)).replace('"/idb.js"', JSON.stringify(idbStub)).replace('"/lib.js"', JSON.stringify(libStub))
  .replace('"./me.js"', JSON.stringify(meStub)).replace('"./network.js"', JSON.stringify(networkStub)).replace('"./session.js"', JSON.stringify(sessionUrl))));

const me = { business: { id: "biz-a", slug: "cafe" }, customer: { id: "customer-a", points: 10 } };
const identity = { businessId: "biz-a", customerId: "customer-a", slug: "cafe" };

function harness(t, online = true) {
  const saved = new Map([["pf_customer_identity", JSON.stringify(identity)], ["pf_customer_slug", "cafe"]]);
  const elements = Object.fromEntries(["#main", "#needLogin", "#btnLogout", "#customerEntrySubtitle", "#qrWrap", "#who"].map(key => [key, {
    hidden: false, textContent: "old private value", replaceChildren() { this.textContent = ""; }, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}
  }]));
  const state = { reads: [], writes: [], renders: [], clears: 0, clear: async () => { state.clears += 1; },
    read: async (...args) => { state.reads.push(args); return { sections: { me } }; },
    write: async (...args) => { state.writes.push(args); },
    render: async (...args) => { state.renders.push(args); elements["#main"].hidden = false; return { status: args[2] ? "live" : "offline" }; }
  };
  for (const [key, value] of Object.entries({ navigator: { onLine: online }, location: { href: "" },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }, __wallet: state })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; });
  }
  return { state, saved, elements, $: key => elements[key] || null, toast() {} };
}

test("explicit auth rejection clears an existing wallet even when the browser reports offline", async t => {
  const h = harness(t, false);
  await loadAll({ ...h, api: async () => { throw Object.assign(new Error("Session ended"), { code: "AUTH_INVALID_SESSION", status: 401 }); } });
  assert.equal(h.state.reads.length, 0);
  assert.equal(h.state.clears, 1);
  assert.equal(h.elements["#main"].hidden, true);
  assert.equal(h.elements["#qrWrap"].textContent, "");
  assert.equal(h.saved.has("pf_customer_identity"), false);
});

test("deleted customer responses remove cached identity instead of leaving the old wallet visible", async t => {
  const h = harness(t);
  await loadAll({ ...h, api: async () => { throw Object.assign(new Error("Customer not found"), { code: "CUSTOMER_NOT_FOUND", status: 404 }); } });
  assert.equal(h.state.clears, 1);
  assert.equal(h.elements["#main"].hidden, true);
});

test("a local cache write failure does not discard a valid live wallet", async t => {
  const h = harness(t);
  h.state.write = async () => { throw new Error("QuotaExceededError"); };
  await loadAll({ ...h, api: async () => me });
  assert.equal(h.state.renders.length, 1);
  assert.equal(h.state.renders[0][2], true);
});

test("HTTP server errors never fall back to cache based only on offline browser state", async t => {
  const h = harness(t, false);
  await loadAll({ ...h, api: async () => { throw Object.assign(new Error("Service unavailable"), { status: 503 }); } });
  assert.equal(h.state.reads.length, 0);
  assert.equal(h.elements["#main"].hidden, true);
});

test("offline snapshots require the last verified business and customer identity", async t => {
  const h = harness(t, false);
  await loadAll({ ...h, api: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(h.state.reads[0][0], identity);
  assert.equal(h.state.renders[0][2], false);
});

test("an unscoped legacy cache cannot open an offline wallet", async t => {
  const h = harness(t, false);
  h.saved.delete("pf_customer_identity");
  await loadAll({ ...h, api: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(h.state.reads.length, 0);
  assert.equal(h.state.renders.length, 0);
});

test("a response started before logout cannot restore private cached or rendered data", async t => {
  const h = harness(t);
  let finish = /** @type {(value: typeof me) => void} */ (() => {});
  const pending = loadAll({ ...h, api: () => new Promise(resolve => { finish = resolve; }) });
  h.saved.set("pf_customer_epoch", "logout");
  h.saved.delete("pf_customer_identity");
  finish(me);
  await pending;
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.renders.length, 0);
});

test("another tab cannot reopen a wallet while logout is pending or failed", async t => {
  const h = harness(t);
  h.saved.set("pf_customer_blocked", "1");
  let calls = 0;
  await loadAll({ ...h, api: async () => { calls += 1; return me; } });
  assert.equal(calls, 0);
  assert.equal(h.state.renders.length, 0);
  assert.equal(h.elements["#main"].hidden, true);
});
