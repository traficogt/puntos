import test from "node:test";
import assert from "node:assert/strict";

import { loadBrowserModule } from "../helpers/browser-module-graph.js";

const library =
  "export const setBrowserRegion=()=>{}, registerServiceWorker=async()=>{}, setHidden=(el,hidden)=>{if(el)el.hidden=hidden;}, isStrongPassword=()=>true, passwordRequirementsText=()=>'';";
const stubs = {
  "/lib.js": library,
  "./operations-health.js":
    "export const createPlatformHealth=({container})=>({load:async()=>{},clear:()=>{container.textContent='';}});",
};
// The owner dashboard is the merchant app (web/merchant/src/api.js owns its logout handshake);
// this file covers the vanilla super console.
const entries = {
  super: new URL("../../public/super/index.js", import.meta.url),
};
let run = 0;

async function setup(t, kind, api, initial = {}) {
  const events = {},
    elements = {},
    messages = [],
    saved = new Map(Object.entries(initial));
  const $ = (key) =>
    (elements[key] ||= {
      hidden: false,
      textContent: "private",
      value: "test",
      classList: { toggle() {} },
      addEventListener: (event, cb) => {
        events[`${key}:${event}`] = cb;
      },
    });
  for (const key of [
    "#main",
    "#needLogin",
    "#planes",
    "#seguridad",
    "#negocios",
    "#salud",
    "#superMfaSecret",
    "#magicLinkOutput",
  ])
    $(key);
  for (const [key, value] of Object.entries({
    location: { href: "" },
    localStorage: {
      getItem: (key) => saved.get(key) || null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
    window: {
      addEventListener: (event, cb) => {
        events[`window:${event}`] = cb;
      },
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  const module = await loadBrowserModule(entries[kind], { stubs, instance: ++run });
  const deps = { api, $, toast: (text) => messages.push(text) };
  await module.initSuperPage(deps);
  return { saved, messages, elements, events, module, deps, logout: events["#btnLogout:click"] };
}

test("super logout failure hides all private cards and secrets without claiming success", async (t) => {
  const h = await setup(t, "super", async (path) => {
    if (path.endsWith("/me")) throw Object.assign(new Error("No autenticado"), { status: 401 });
    throw new TypeError("Failed to fetch");
  });
  for (const key of ["#planes", "#seguridad", "#negocios"]) h.elements[key].hidden = false;
  await h.logout();
  for (const key of ["#planes", "#seguridad", "#negocios"])
    assert.equal(h.elements[key].hidden, true);
  assert.equal(h.elements["#superMfaSecret"].textContent, "");
  assert.equal(h.elements["#magicLinkOutput"].textContent, "");
  assert.equal(h.saved.get("pf_super_logout_pending"), "1");
  assert.ok(!h.messages.includes("Sesión cerrada."));
});

test("super pending logout retries on reconnect and never reopens the old cookie on initial load", async (t) => {
  let fail = true;
  const calls = [];
  const h = await setup(
    t,
    "super",
    async (path) => {
      calls.push(path);
      if (fail) throw new TypeError("Failed to fetch");
      return { ok: true };
    },
    { pf_super_logout_pending: "1" },
  );
  assert.ok(!calls.includes("/api/super/me"));
  fail = false;
  await h.events["window:online"]();
  assert.equal(h.saved.has("pf_super_logout_pending"), false);
  assert.ok(h.messages.includes("Sesión cerrada."));
});

test("super login cannot replace a session while its pending logout still fails", async (t) => {
  const calls = [];
  const h = await setup(
    t,
    "super",
    async (path) => {
      calls.push(path);
      throw new TypeError("Failed to fetch");
    },
    { pf_super_logout_pending: "1" },
  );
  await h.events["#btnLogin:click"]();
  assert.ok(!calls.includes("/api/super/login"));
  assert.equal(h.saved.get("pf_super_logout_pending"), "1");
});
