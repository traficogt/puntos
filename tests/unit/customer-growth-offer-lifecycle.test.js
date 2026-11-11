import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const sessionUrl = new URL("../../public/customer/session.js", import.meta.url).href;
const libStub = dataModule("export const setHidden=(element,hidden)=>{if(element){element.hidden=hidden;element.classList.toggle('is-hidden',hidden);}};export const registerServiceWorker=async()=>{};");
const idbStub = dataModule("export const clearCustomerCache=async()=>{globalThis.__growthLifecycle.clears++;};export const getCustomerCacheSnapshot=async()=>({sections:{me:globalThis.__growthLifecycle.me}});export const putCustomerCache=async(...args)=>{globalThis.__growthLifecycle.writes.push(args);};");
const meStub = dataModule("export const renderFromMe=async({$},me,online)=>{globalThis.__growthLifecycle.renders.push({me,online});$('#main').hidden=false;return {status:online?'live':'offline'};};");
const networkStub = dataModule("export const setOnlineBadge=()=>{};");
const qrStub = dataModule("export const createQrController=()=>({generateQR:async()=>{},dispose:()=>{globalThis.__growthLifecycle.disposed++;}});");
// All module sources are fixed repository fixtures; only browser-only imports are replaced.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const offerSource = await readFile(new URL("../../public/customer/growth-offers.js", import.meta.url), "utf8");
const offerUrl = dataModule(offerSource.replace(/(['"])\/lib\.js\1/, JSON.stringify(libStub)).replace(/(['"])\.\/session\.js\1/, JSON.stringify(sessionUrl)));
// eslint-disable-next-line security/detect-non-literal-fs-filename
const loadSource = await readFile(new URL("../../public/customer/load.js", import.meta.url), "utf8");
// eslint-disable-next-line security/detect-non-literal-fs-filename
const entitlementSource = await readFile(new URL("../../public/customer/reward-entitlements.js", import.meta.url), "utf8");
const entitlementUrl = dataModule(entitlementSource.replace("'/lib.js'", JSON.stringify(libStub)).replace("'./session.js'", JSON.stringify(sessionUrl)));
const { loadRewardEntitlements } = await import(entitlementUrl);
const loadUrl = dataModule(loadSource.replace('"./reward-entitlements.js"', JSON.stringify(entitlementUrl)).replace(/(['"])\.\/growth-offers\.js\1/, JSON.stringify(offerUrl))
  .replace(/(['"])\/idb\.js\1/, JSON.stringify(idbStub)).replace(/(['"])\/lib\.js\1/, JSON.stringify(libStub))
  .replace(/(['"])\.\/me\.js\1/, JSON.stringify(meStub)).replace(/(['"])\.\/network\.js\1/, JSON.stringify(networkStub))
  .replace(/(['"])\.\/session\.js\1/, JSON.stringify(sessionUrl)));
const { loadAll } = await import(loadUrl);
const { clearWalletView } = await import(sessionUrl);
// eslint-disable-next-line security/detect-non-literal-fs-filename
const indexSource = await readFile(new URL("../../public/customer/index.js", import.meta.url), "utf8");
const { initCustomerPage } = await import(dataModule(indexSource
  .replace('"./reward-entitlements.js"', JSON.stringify(entitlementUrl))
  .replace(/(['"])\.\/growth-offers\.js\1/, JSON.stringify(offerUrl))
  .replace(/(['"])\/idb\.js\1/, JSON.stringify(idbStub)).replace(/(['"])\/lib\.js\1/, JSON.stringify(libStub))
  .replace(/(['"])\.\/load\.js\1/, JSON.stringify(loadUrl)).replace(/(['"])\.\/network\.js\1/, JSON.stringify(networkStub))
  .replace(/(['"])\.\/qr\.js\1/, JSON.stringify(qrStub)).replace(/(['"])\.\/session\.js\1/, JSON.stringify(sessionUrl))));

const offer = { id: "offer-a", name: "Regresa por tu café", bonus_points: 50, minimum_purchase_q: 40, expires_at: "2026-12-01T18:00:00Z" };
const me = { business: { id: "business-a", slug: "cafe" }, customer: { id: "customer-a", points: 100 } };

function deferred() {
  let resolve = /** @type {(value?: any) => void} */ (() => {});
  let reject = /** @type {(error: Error) => void} */ (() => {});
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function element(tag = "div") {
  const classes = new Set(), events = new Map();
  let text = "";
  return {
    tagName: tag, children: [], hidden: false, disabled: false, dataset: {},
    get textContent() { return text + this.children.map(child => child.textContent).join(""); },
    set textContent(value) { text = String(value); this.children = []; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; text = ""; },
    addEventListener(name, handler) { events.set(name, handler); },
    dispatchEvent(event) { return events.get(event.type)?.(event); },
    classList: { contains: value => classes.has(value), toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); } },
  };
}

function setup(t) {
  const selectors = ["#growthOffers", "#growthOffersSection", "#main", "#needLogin", "#btnLogout", "#btnRefreshWallet", "#qrWrap", "#who", "#customerEntrySubtitle"];
  const elements = Object.fromEntries(selectors.map(selector => [selector, element()]));
  const saved = new Map([["pf_customer_identity", JSON.stringify({ businessId: "business-a", customerId: "customer-a", slug: "cafe" })], ["pf_customer_slug", "cafe"]]);
  const events = new Map(), state = { me, writes: [], renders: [], clears: 0, disposed: 0, calls: [], toasts: [] };
  const browserNavigator = { onLine: true };
  const values = {
    __growthLifecycle: state, navigator: browserNavigator,
    document: { createElement: element, addEventListener() {}, visibilityState: "visible" },
    window: { addEventListener: (name, handler) => events.set(name, handler), setInterval: () => 1, clearInterval() {} },
    location: { href: "", search: "", pathname: "/mi-tarjeta/", reload() {} },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  const $ = selector => elements[selector] || null;
  const api = async (path, options) => {
    state.calls.push({ path, options });
    if (path === "/api/customer/me") return me;
    if (path === "/api/customer/growth-offers") return { offers: [offer] };
    if (path === "/api/public/customer/logout") return { ok: true };
    throw new Error(`Unexpected isolated request: ${path}`);
  };
  return { $, api, state, elements, events, saved, browserNavigator, toast: message => state.toasts.push(message), mountIosInstallHint() {}, modalAlert: async () => {} };
}

test("live customer offers are fetched without caching and are cleared at the start of refresh", async t => {
  const h = setup(t);
  await loadAll(h);
  assert.match(h.$("#growthOffers").textContent, /Regresa por tu café/);
  assert.equal(h.$("#growthOffersSection").hidden, false);
  assert.equal(h.state.calls.find(call => call.path.endsWith("growth-offers")).options.cache, "no-store");
  assert.ok(h.state.writes.every(write => write[0] !== "growth-offers"));
  const gate = deferred();
  const pending = loadAll({ ...h, api: () => gate.promise });
  assert.equal(h.$("#growthOffers").textContent, "");
  assert.equal(h.$("#growthOffersSection").hidden, true);
  h.saved.set("pf_customer_epoch", "new-session");
  gate.resolve(me);
  assert.equal((await pending).status, "superseded");
});

test('protected choices distinguish enough points from confirmed redemption eligibility', async t => {
  const h = setup(t);
  h.elements['#rewardEntitlements'] = element();
  h.elements['#rewardEntitlementsSection'] = element();
  await loadRewardEntitlements({ ...h, isCurrent: () => true, api: async () => ({ points: 100, server_now: new Date().toISOString(), cycle: { program_type: 'VISIT', earning_terms: { points_per_visit: 10 }, observed_at: new Date().toISOString() }, promises: [{ reward_name: 'Café original', points_cost: 50, available: true, stock: 5, branch_ids: [] }], hospitality: [] }) });
  assert.match(h.$('#rewardEntitlements').textContent, /Tienes los puntos necesarios/);
  assert.match(h.$('#rewardEntitlements').textContent, /confirma en caja/);
  assert.doesNotMatch(h.$('#rewardEntitlements').textContent, /Disponible para canjear/);
});

test("offer responses from a superseded refresh cannot replace the newest customer's offers", async t => {
  const h = setup(t), gate = deferred(), entered = deferred();
  const pending = loadAll({ ...h, api: async path => {
    if (path === "/api/customer/me") return me;
    entered.resolve(); return gate.promise;
  } });
  await entered.promise;
  await loadAll({ ...h, api: async path => path === "/api/customer/me" ? me : { offers: [{ ...offer, name: "Nueva oferta" }] } });
  gate.resolve({ offers: [offer] });
  assert.equal((await pending).status, "superseded");
  assert.match(h.$("#growthOffers").textContent, /Nueva oferta/);
  assert.doesNotMatch(h.$("#growthOffers").textContent, /Regresa por tu café/);
});

test("logout clears displayed offers and a late offer response cannot restore them", async t => {
  const h = setup(t);
  await initCustomerPage(h);
  const gate = deferred(), entered = deferred();
  const pending = loadAll({ ...h, api: async path => {
    if (path === "/api/customer/me") return me;
    entered.resolve(); return gate.promise;
  } });
  await entered.promise;
  await h.$("#btnLogout").dispatchEvent(new Event("click"));
  assert.equal(h.$("#growthOffers").textContent, "");
  assert.equal(h.$("#growthOffersSection").hidden, true);
  gate.resolve({ offers: [offer] });
  assert.equal((await pending).status, "superseded");
  assert.equal(h.$("#growthOffers").textContent, "");
  assert.equal(h.saved.get("pf_customer_blocked"), "1");
});

test("auth loss in the offer request clears the full wallet rather than showing a network-only note", async t => {
  const h = setup(t);
  await loadAll(h);
  const result = await loadAll({ ...h, api: async path => {
    if (path === "/api/customer/me") return me;
    throw Object.assign(new Error("Session ended"), { status: 401, code: "AUTH_INVALID_SESSION" });
  } });
  assert.equal(result.status, "auth");
  assert.equal(h.$("#main").hidden, true);
  assert.equal(h.$("#growthOffers").textContent, "");
  assert.equal(h.$("#growthOffersSection").hidden, true);
  assert.equal(h.saved.has("pf_customer_identity"), false);
  assert.equal(h.state.clears, 1);
});

test("offline wallet refresh renders its verified snapshot without stale offers", async t => {
  const h = setup(t);
  await loadAll(h);
  h.browserNavigator.onLine = false;
  const calls = [];
  const result = await loadAll({ ...h, api: async path => { calls.push(path); throw new TypeError("Failed to fetch"); } });
  assert.equal(result.status, "offline");
  assert.equal(h.$("#growthOffers").textContent, "");
  assert.equal(h.$("#growthOffersSection").hidden, true);
  assert.deepEqual(calls, ["/api/customer/me"]);
  assert.equal(h.state.renders.at(-1).online, false);
});

test("transitioning offline immediately clears a previously displayed live offer", async t => {
  const h = setup(t);
  await initCustomerPage(h);
  assert.match(h.$("#growthOffers").textContent, /Regresa por tu café/);
  h.browserNavigator.onLine = false;
  h.events.get("offline")();
  assert.equal(h.$("#growthOffersSection").hidden, true);
  assert.equal(h.$("#growthOffers").textContent, "");
});

test("an in-flight offer response cannot reappear after the browser goes offline", async t => {
  const h = setup(t);
  await initCustomerPage(h);
  const gate = deferred(), entered = deferred();
  const pending = loadAll({ ...h, api: async path => {
    if (path === "/api/customer/me") return me;
    entered.resolve(); return gate.promise;
  } });
  await entered.promise;
  h.browserNavigator.onLine = false;
  h.events.get("offline")();
  gate.resolve({ offers: [offer] });
  await pending;
  assert.equal(h.$("#growthOffersSection").hidden, true);
  assert.equal(h.$("#growthOffers").textContent, "");
});

test("wallet clearing includes offers independently of the refresh path", t => {
  const h = setup(t);
  h.$("#growthOffers").textContent = "Private offer";
  clearWalletView(h.$);
  assert.equal(h.$("#growthOffers").textContent, "");
  assert.equal(h.$("#growthOffersSection").hidden, true);
});

test("the service worker installs every new static offer dependency needed by an offline wallet", async () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = await readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
  const handlers = new Map(), cached = new Map(), origin = "https://app.example.test";
  let online = true;
  const key = request => typeof request === "string" ? new URL(request, origin).href : request.url;
  const context = vm.createContext({
    URL, Set, Map, Error, Promise,
    Request: class { url; constructor(value) { this.url = new URL(value, origin).href; } },
    self: { location: { origin }, addEventListener: (event, handler) => handlers.set(event, handler), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => ({ put: async (request, response) => cached.set(key(request), response), match: async request => cached.get(key(request)) }) },
    fetch: async request => { if (!online) throw new TypeError("Failed to fetch"); return { ok: true, type: "basic", url: key(request), clone() { return this; } }; },
  });
  vm.runInContext(source, context);
  let install = Promise.resolve();
  handlers.get("install")({ waitUntil: promise => { install = promise; } });
  await install;
  online = false;
  let response = Promise.resolve(null);
  handlers.get("fetch")({ request: { url: `${origin}/customer/growth-offers.js`, method: "GET", mode: "cors", destination: "script" }, respondWith: promise => { response = promise; } });
  const result = await response;
  assert.ok(result?.ok, "The new eagerly imported offer module must load from the installed offline shell");
});
