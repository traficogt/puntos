import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const source = await fs.readFile(new URL("../../public/customer-auth-entry.js", import.meta.url), "utf8");
const { initCustomerAuthEntry } = await import(data(source
  .replace('"/lib.js"', JSON.stringify(data("export const api=(...a)=>globalThis.__entry.api(...a);export const $=key=>globalThis.__entry.$(key);export const toast=message=>globalThis.__entry.messages.push(message);export const setHidden=(el,value)=>{el.hidden=value;};export const hydrateShellLinks=()=>{};")))
  .replace('"./acquisition-entry.js"', JSON.stringify(new URL("../../public/acquisition-entry.js", import.meta.url).href))
  .replace('"./customer-branding.js"', JSON.stringify(data("export const applyJoinBranding=()=>({businessName:'Cafe'});")))
  .replace('"/idb.js"', JSON.stringify(data("export const clearCustomerCache=async()=>{globalThis.__entry.clears++;};")))
  .replace('"./customer/native-wallet.js"', JSON.stringify(new URL("../../public/customer/native-wallet.js", import.meta.url).href))
  .replace('"./customer/session.js"', JSON.stringify(new URL("../../public/customer/session.js", import.meta.url).href))));

function setup(t, restricted = false) {
  const events = {}, elements = {}, saved = new Map([["pf_customer_identity", "old-account"]]);
  const h = { clears: 0, calls: [], messages: [], authenticated: false, businessId: "business-one", customerId: "customer-one", providers: { apple: true, google: false }, verifyError: null, walletError: null, meError: null, loseVerifyResponse: false, sessionPhone: "50212345678", region: null,
    api: async (path, options) => {
      h.calls.push({ path, options });
      if (path.endsWith("/verify")) {
        if (h.verifyError) throw h.verifyError;
        h.authenticated = true;
        if (h.loseVerifyResponse) throw new Error("Failed to fetch");
        return { ok: true, customer: { id: h.customerId } };
      }
      if (path === "/api/customer/me") {
        if (h.authenticated && h.meError) throw h.meError;
        if (!h.authenticated) throw Object.assign(new Error("Sign in"), { status: 401 });
        return { business: { id: h.businessId, slug: "cafe" }, customer: { id: h.customerId, phone: h.sessionPhone } };
      }
      if (path === "/api/customer/wallet") {
        if (h.walletError) throw h.walletError;
        return { providers: h.providers, passes: [] };
      }
      if (path.endsWith("/wallet/apple")) return { url: "/api/customer/wallet/apple/download" };
      return { id: "business-one", name: "Cafe", region: h.region };
    },
    $: key => elements[key] ||= { value: key === "#phone" ? "12345678" : key === "#code" ? "123456" : "", hidden: true, dataset: {}, setAttribute() {}, classList: { toggle() {}, remove() {} }, focus() {}, addEventListener: (event, callback) => { events[`${key}:${event}`] = callback; } }
  };
  for (const [key, value] of Object.entries({ __entry: h, location: { pathname: "/ingresar/cafe", search: "", href: "", assign(url) { globalThis.location.href = url; } }, navigator: { onLine: true },
    document: { title: "", getElementById: id => h.$(`#${id}`), addEventListener: (event, callback) => { events[`document:${event}`] = callback; } }, window: { addEventListener: (event, callback) => { events[`window:${event}`] = callback; } },
    localStorage: { getItem: key => { if (restricted) throw new Error("SecurityError"); return saved.get(key) || null; },
      setItem: (key, value) => { if (restricted) throw new Error("SecurityError"); saved.set(key, value); }, removeItem: key => saved.delete(key) } })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, "setTimeout", /** @type {any} */ (fn => { fn(); return 1; }));
  t.mock.method(globalThis, "setInterval", /** @type {any} */ (() => 1));
  return { h, events, elements, saved };
}

test("login entry still works when browser local storage is unavailable", async t => {
  const { events } = setup(t, true);
  await initCustomerAuthEntry({ mode: "login" });
  assert.equal(typeof events["#btnVerify:click"], "function");
});

test("successful verification clears the previous account cache before opening the wallet", async t => {
  const { h, events, saved } = setup(t);
  await initCustomerAuthEntry({ mode: "login" });
  await events["#btnVerify:click"]();
  assert.equal(h.clears, 1);
  assert.equal(saved.has("pf_customer_identity"), false);
  assert.equal(location.href, "");
  assert.equal(h.$("#done").hidden, false);
  assert.equal(h.$("#btnAppleWallet").hidden, false);
  assert.equal(h.$("#btnGoogleWallet").hidden, true);
  assert.equal(h.$("#joinForms").hidden, true);
  assert.equal(h.calls.filter(call => call.path.endsWith("/wallet/apple")).length, 0);
  await h.$("#btnAppleWallet").onclick();
  assert.equal(location.href, "/api/customer/wallet/apple/download");
});

test("Spanish expired-session links explain why a new code is required", async t => {
  const { h } = setup(t);
  location.search = "?motivo=sesion-vencida";
  await initCustomerAuthEntry({ mode: "login" });
  assert.match(h.$("#joinEntryContext").textContent, /sesión anterior.*venció/);
});


test("active session for the current business skips verification without issuing automatically", async t => {
  const { h } = setup(t);
  h.authenticated = true;
  await initCustomerAuthEntry({ mode: "register" });
  assert.equal(h.$("#done").hidden, false);
  assert.equal(h.$("#btnAppleWallet").hidden, false);
  assert.equal(h.calls.some(call => call.options?.method === "POST"), false);
});

test("a different business session must not offer that member's Wallet card", async t => {
  const { h } = setup(t);
  h.authenticated = true;
  h.businessId = "different-business";
  await initCustomerAuthEntry({ mode: "register" });
  assert.equal(h.$("#done").hidden, true);
  assert.equal(h.calls.some(call => call.path === "/api/customer/wallet"), false);
});

test("failed verification cannot reveal or issue a Wallet card", async t => {
  const { h, events } = setup(t);
  h.verifyError = new Error("Código incorrecto");
  await initCustomerAuthEntry({ mode: "register" });
  await events["#btnVerify:click"]();
  assert.equal(h.$("#done").hidden, true);
  assert.equal(h.calls.some(call => call.path === "/api/customer/wallet"), false);
  assert.match(h.$("#joinVerifyFeedback").textContent, /incorrecto/);
});

test("Wallet status failure preserves the completed account and permits retry", async t => {
  const { h, events } = setup(t);
  h.walletError = new Error("Unavailable");
  await initCustomerAuthEntry({ mode: "register" });
  await events["#btnVerify:click"]();
  assert.equal(h.$("#done").hidden, false);
  assert.equal(h.$("#billeteras").hidden, true);
  assert.equal(h.$("#btnRetryWallet").hidden, false);
  assert.equal(location.href, "");
  h.walletError = null;
  await events["#btnRetryWallet:click"]();
  assert.equal(h.$("#btnAppleWallet").hidden, false);
  assert.equal(h.calls.filter(call => call.path.endsWith("/verify")).length, 1);
});

test("another tab changing the customer epoch prevents an old completion from saving", async t => {
  const { h, events, saved } = setup(t);
  await initCustomerAuthEntry({ mode: "register" });
  await events["#btnVerify:click"]();
  saved.set("pf_customer_epoch", "another-login");
  await events["window:storage"]({ key: "pf_customer_epoch" });
  await h.$("#btnAppleWallet").onclick();
  assert.equal(location.href, "");
  assert.equal(h.$("#done").hidden, true);
});


test("a network failure after successful verification retries the session instead of reusing the consumed code", async t => {
  const { h, events } = setup(t);
  h.meError = new Error("Failed to fetch");
  await initCustomerAuthEntry({ mode: "register" });
  await events["#btnVerify:click"]();
  assert.equal(h.$("#done").hidden, false);
  assert.equal(h.$("#btnRetryWallet").hidden, false);
  assert.equal(h.calls.some(call => call.path === "/api/customer/wallet"), false);
  h.meError = null;
  await events["#btnRetryWallet:click"]();
  assert.equal(h.$("#btnAppleWallet").hidden, false);
  assert.equal(h.calls.filter(call => call.path.endsWith("/verify")).length, 1);
});

test("code delivery moves to one verification step and changing the phone resets it", async t => {
  const { h, events } = setup(t);
  await initCustomerAuthEntry({ mode: "register" });
  await events["#btnCode:click"]();
  assert.equal(h.$("#joinRequestForm").hidden, true);
  assert.equal(h.$("#joinVerifyStage").hidden, false);
  assert.equal(h.$("#btnResendCode").disabled, true);
  await events["#btnChangePhone:click"]();
  assert.equal(h.$("#joinRequestForm").hidden, false);
  assert.equal(h.$("#joinVerifyStage").hidden, true);
  assert.equal(h.$("#phone").readOnly, false);
  assert.equal(h.$("#code").value, "");
});

test("browser back restores the resend button after the cooldown has elapsed", async t => {
  const { h, events } = setup(t);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  await initCustomerAuthEntry({ mode: "register" });
  await events["#btnCode:click"]();
  events["window:pagehide"]();
  now += 61000;
  await events["window:pageshow"]({ persisted: true });
  assert.equal(h.$("#btnResendCode").disabled, false);
});

test("automatic reconnect failure leaves an explicit retry available", async t => {
  const { h, events } = setup(t);
  h.authenticated = true;
  await initCustomerAuthEntry({ mode: "register" });
  h.meError = new Error("Failed to fetch");
  await events["window:online"]();
  assert.equal(h.$("#btnRetryWallet").hidden, false);
});

test("phone recipient is frozen before code delivery resolves", async t => {
  const { h, events } = setup(t);
  await initCustomerAuthEntry({ mode: "register" });
  const pending = events["#btnCode:click"]();
  assert.equal(h.$("#phone").readOnly, true);
  await pending;
});

test("a lost verification response recovers only the matching authenticated phone and business", async t => {
  const { h, events } = setup(t);
  h.loseVerifyResponse = true;
  await initCustomerAuthEntry({ mode: "register" });
  await events["#btnVerify:click"]();
  assert.equal(h.$("#done").hidden, false);
  assert.equal(h.$("#btnAppleWallet").hidden, false);
  assert.equal(h.calls.filter(call => call.path.endsWith("/verify")).length, 1);
});

test("lost verification response never recovers a session for a different phone", async t => {
  const { h, events } = setup(t);
  h.loseVerifyResponse = true;
  h.sessionPhone = "50287654321";
  await initCustomerAuthEntry({ mode: "register" });
  await events["#btnVerify:click"]();
  assert.equal(h.$("#done").hidden, true);
  assert.equal(h.calls.some(call => call.path === "/api/customer/wallet"), false);
});

test("international enrollment keeps the explicit number and explains its prefix", async t => {
 const {h}=setup(t);h.region={country:'MX',currency:'MXN',timezone:'America/Mexico_City'};
 await initCustomerAuthEntry({mode:"register"});
 assert.equal(h.$('#phone').placeholder,'+ código de país y número');
 assert.match(h.$('#phoneHelp').textContent,/código internacional/);
});
