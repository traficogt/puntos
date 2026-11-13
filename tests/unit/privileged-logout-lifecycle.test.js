import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const library = data("export const setBrowserRegion=()=>{}, registerServiceWorker=async()=>{}, setHidden=(el,hidden)=>{if(el)el.hidden=hidden;}, isStrongPassword=()=>true, passwordRequirementsText=()=>'';");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const adminSource = await fs.readFile(new URL("../../public/admin-dashboard/session-controller.js", import.meta.url), "utf8");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const logoutSource = await fs.readFile(new URL("../../public/admin-dashboard/logout-controller.js", import.meta.url), "utf8");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const superSource = await fs.readFile(new URL("../../public/super/index.js", import.meta.url), "utf8");
let run = 0;

async function setup(t, kind, api, initial = {}) {
  const events = {}, elements = {}, messages = [], saved = new Map(Object.entries(initial));
  const $ = key => elements[key] ||= {
    hidden: false, textContent: "private", value: "test", classList: { toggle() {} },
    addEventListener: (event, cb) => { events[`${key}:${event}`] = cb; }
  };
  for (const key of ["#main", "#needLogin", "#planes", "#seguridad", "#negocios", "#salud", "#superMfaSecret", "#magicLinkOutput"]) $(key);
  for (const [key, value] of Object.entries({ location: { href: "" },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    window: { addEventListener: (event, cb) => { events[`window:${event}`] = cb; } }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  const instance = ++run;
  const module = await import(data((kind === "admin" ? adminSource : superSource)
    .replace('"/lib.js"', JSON.stringify(library))
    .replace("'./operations-health.js'", JSON.stringify(data("export const createPlatformHealth=({container})=>({load:async()=>{},clear:()=>{container.textContent='';}});")))
    .replace('"./logout-controller.js"', JSON.stringify(data(logoutSource.replace('"/lib.js"', JSON.stringify(library)) + `\n// run ${instance}`)))
    .replace('"./view-state.js"', JSON.stringify(data("export const copyCurrentViewUrl=async()=>{};"))) + `\n// run ${instance}`));
  const deps = { api, $, toast: text => messages.push(text), syncDashboardViewToUrl() {} };
  if (kind === "admin") module.initDashboardChrome(deps);
  else await module.initSuperPage(deps);
  return { saved, messages, elements, events, module, deps, logout: events["#btnLogout:click"] };
}

test("owner logout failure hides private view, blocks cached staff identity, and retries on reconnect", async t => {
  let fail = true;
  const h = await setup(t, "admin", async () => { if (fail) throw new TypeError("Failed to fetch"); return { ok: true }; }, { pf_staff_snapshot: "old staff" });
  await h.logout();
  assert.equal(h.elements["#main"].hidden, true);
  assert.equal(h.saved.has("pf_staff_snapshot"), false);
  assert.equal(h.saved.get("pf_staff_logout_pending"), "1");
  assert.equal(location.href, "");
  assert.ok(h.messages.some(message => /no se pudo.*sesión/i.test(message)));
  fail = false;
  await h.events["window:online"]();
  assert.equal(h.saved.has("pf_staff_logout_pending"), false);
  assert.equal(location.href, "/equipo/ingresar/");
});

test("a late owner session response cannot reopen the dashboard after logout", async t => {
  let resolveMe = (_value) => {};
  const response = new Promise(resolve => { resolveMe = resolve; });
  const h = await setup(t, "admin", async path => path.endsWith("/me") ? response : { ok: true });
  const state = {};
  const pending = h.module.loadStaffSession({ ...h.deps, state });
  await h.logout();
  resolveMe({ staff: { role: "OWNER" } });
  assert.equal(await pending, false);
  assert.equal(h.elements["#main"].hidden, true);
});

test("owner dashboard refuses a pending local logout before checking the old cookie", async t => {
  const calls = [];
  const h = await setup(t, "admin", async path => { calls.push(path); throw new TypeError("Failed to fetch"); }, { pf_staff_logout_pending: "1" });
  const result = await h.module.loadStaffSession({ ...h.deps, state: {} });
  assert.equal(result, false);
  assert.ok(!calls.includes("/api/staff/me"));
});

test("super logout failure hides all private cards and secrets without claiming success", async t => {
  const h = await setup(t, "super", async path => {
    if (path.endsWith("/me")) throw Object.assign(new Error("No autenticado"), { status: 401 });
    throw new TypeError("Failed to fetch");
  });
  for (const key of ["#planes", "#seguridad", "#negocios"]) h.elements[key].hidden = false;
  await h.logout();
  for (const key of ["#planes", "#seguridad", "#negocios"]) assert.equal(h.elements[key].hidden, true);
  assert.equal(h.elements["#superMfaSecret"].textContent, "");
  assert.equal(h.elements["#magicLinkOutput"].textContent, "");
  assert.equal(h.saved.get("pf_super_logout_pending"), "1");
  assert.ok(!h.messages.includes("Sesión cerrada."));
});

test("super pending logout retries on reconnect and never reopens the old cookie on initial load", async t => {
  let fail = true;
  const calls = [];
  const h = await setup(t, "super", async path => {
    calls.push(path);
    if (fail) throw new TypeError("Failed to fetch");
    return { ok: true };
  }, { pf_super_logout_pending: "1" });
  assert.ok(!calls.includes("/api/super/me"));
  fail = false;
  await h.events["window:online"]();
  assert.equal(h.saved.has("pf_super_logout_pending"), false);
  assert.ok(h.messages.includes("Sesión cerrada."));
});

test("super login cannot replace a session while its pending logout still fails", async t => {
  const calls = [];
  const h = await setup(t, "super", async path => { calls.push(path); throw new TypeError("Failed to fetch"); }, { pf_super_logout_pending: "1" });
  await h.events["#btnLogin:click"]();
  assert.ok(!calls.includes("/api/super/login"));
  assert.equal(h.saved.get("pf_super_logout_pending"), "1");
});
