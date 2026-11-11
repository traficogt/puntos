import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const source = await fs.readFile(new URL("../../public/staff-login.js", import.meta.url), "utf8");
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
let run = 0;

async function setup(t, api, initial = {}, search = "") {
  const events = {}, messages = [], saved = new Map(Object.entries(initial));
  const elements = {};
  const harness = { api, toast: message => messages.push(message), $: key => elements[key] ||= {
    value: key === "#email" ? "staff@example.test" : "password",
    addEventListener: (event, cb) => { events[`${key}:${event}`] = cb; }
  } };
  for (const [key, value] of Object.entries({ __staffLogin: harness, location: { href: "", search },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, "setTimeout", /** @type {any} */ (fn => { fn(); return 1; }));
  await import(data(source.replace('"./staff-return-path.js"', JSON.stringify(new URL("../../public/staff-return-path.js", import.meta.url).href)).replace('"/lib.js"', JSON.stringify(data(
    "export const api=(...args)=>globalThis.__staffLogin.api(...args), $=key=>globalThis.__staffLogin.$(key), toast=text=>globalThis.__staffLogin.toast(text), hydrateShellLinks=()=>{};"
  ))) + `\n// run ${++run}`));
  return { saved, messages, login: events["#btnLogin:click"], logout: events["#btnLogout:click"] };
}

test("staff login clears old offline identity and announces a new authenticated epoch", async t => {
  const h = await setup(t, async () => ({ staff: { role: "STAFF" } }), { pf_staff_snapshot: "old account", pf_staff_epoch: "old" });
  await h.login();
  assert.equal(h.saved.has("pf_staff_snapshot"), false);
  assert.notEqual(h.saved.get("pf_staff_epoch"), "old");
  assert.equal(location.href, "/equipo/escaner/");
});

test("staff login finishes pending logout before submitting new credentials", async t => {
  const calls = [];
  const h = await setup(t, async path => { calls.push(path); return { staff: { role: "OWNER" } }; }, { pf_staff_logout_pending: "1" });
  await h.login();
  assert.deepEqual(calls, ["/api/staff/logout", "/api/staff/login"]);
  assert.equal(h.saved.has("pf_staff_logout_pending"), false);
  assert.equal(location.href, "/negocio/");
});

test("failed pending logout prevents a new staff login and retains the local block", async t => {
  const calls = [];
  const h = await setup(t, async path => { calls.push(path); throw new TypeError("Failed to fetch"); }, { pf_staff_logout_pending: "1" });
  await h.login();
  assert.deepEqual(calls, ["/api/staff/logout"]);
  assert.equal(h.saved.get("pf_staff_logout_pending"), "1");
  assert.equal(location.href, "");
});

test("failed explicit staff logout removes cached identity without claiming server revocation", async t => {
  const h = await setup(t, async () => { throw new TypeError("Failed to fetch"); }, { pf_staff_snapshot: "old account", pf_staff_epoch: "old" });
  await h.logout();
  assert.equal(h.saved.has("pf_staff_snapshot"), false);
  assert.equal(h.saved.get("pf_staff_logout_pending"), "1");
  assert.notEqual(h.saved.get("pf_staff_epoch"), "old");
  assert.equal(h.messages.includes("Sesión cerrada."), false);
});

test("already expired staff session does not block login after pending logout", async t => {
  const calls = [];
  const h = await setup(t, async path => {
    calls.push(path);
    if (path.endsWith("logout")) throw Object.assign(new Error("No autenticado"), { status: 401 });
    return { staff: { role: "STAFF" } };
  }, { pf_staff_logout_pending: "1" });
  await h.login();
  assert.deepEqual(calls, ["/api/staff/logout", "/api/staff/login"]);
  assert.equal(location.href, "/equipo/escaner/");
});

for (const [role, destination] of [['OWNER', '/negocio/#region'], ['MANAGER', '/administracion/'], ['CASHIER', '/equipo/escaner/']]) {
 test(`login preserves an authorized target for ${role}`, async t => {
  const h = await setup(t, async () => ({staff:{role}}), {}, '?return_to=%2Fnegocio%2F%23region');
  await h.login(); assert.equal(location.href, destination);
 });
}
