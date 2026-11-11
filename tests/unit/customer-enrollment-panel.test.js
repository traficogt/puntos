import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const fixture = () => {
  const elements = new Map(), events = new Map();
  let epoch = 1;
  const state = { currentStaff: { id: "owner", business_id: "business-one", role: "OWNER" } };
  const data = { ok: true, business: { id: "business-one", name: "Café", slug: "cafe" }, registration_url: "https://app.puntosfieles.com/registro/cafe" };
  const calls = [], copied = [];
  const app = { state, api: async path => { calls.push(path); return data; }, $: selector => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: false, value: "", disabled: false, href: "", src: "", dataset: {}, textContent: "", tabIndex: 0,
      classList: { toggle() {} }, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { this[key] = ""; },
      addEventListener(event, listener) { events.set(`${selector}:${event}`, listener); },
      focus() { this.focused = true; }, select() { this.selected = true; }, setSelectionRange() { this.selected = true; }
    });
    return elements.get(selector);
  } };
  return { app, data, calls, copied, elements, events, capture: () => { const captured = epoch; return () => epoch === captured; },
    blocked: () => false, changeEpoch: () => { epoch++; } };
};

test("customer invitation panel keeps actions bound to the loaded staff session", async t => {
  // The fixture reads one fixed repository module, not a user-supplied path.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = await readFile(new URL("../../public/admin-dashboard/modules/customer-enrollment.js", import.meta.url), "utf8").catch(() => "");
  assert.ok(source, "the persistent invitation panel must exist");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source.replace('"../logout-controller.js"',
    JSON.stringify(`data:text/javascript,${encodeURIComponent("export const captureDashboardSession=()=>globalThis.__invitation.capture();export const isDashboardSessionBlocked=()=>globalThis.__invitation.blocked();")}`))).toString("base64")}`;
  const { createCustomerEnrollment } = await import(moduleUrl);
  const originals = new Map();
  function install(f) {
    for (const [key, value] of Object.entries({ __invitation: f,
      navigator: { clipboard: { writeText: async text => { f.copied.push(text); } } },
      window: { addEventListener: (event, listener) => { f.events.set(`window:${event}`, listener); } }
    })) {
      if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });

  await t.test("owner loads a selectable URL and authenticated QR preview/download", async () => {
    const f = fixture(); install(f);
    const panel = createCustomerEnrollment(f.app);
    await panel.load();
    assert.equal(f.app.$("#customerEnrollmentUrl").value, f.data.registration_url);
    assert.equal(f.app.$("#customerEnrollmentQr").src, "/api/admin/customer-enrollment/qr.svg");
    assert.equal(f.app.$("#customerEnrollmentDownload").href, "/api/admin/customer-enrollment/qr.svg?download=1");
    await f.events.get("#customerEnrollmentCopy:click")();
    assert.deepEqual(f.copied, [f.data.registration_url]);
    assert.equal(f.calls.length, 1);
  });
  await t.test("clipboard denial selects the readonly URL for manual copying", async () => {
    const f = fixture(); install(f);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
    await createCustomerEnrollment(f.app).load();
    await f.events.get("#customerEnrollmentCopy:click")();
    assert.equal(f.app.$("#customerEnrollmentUrl").selected, true);
    assert.match(f.app.$("#customerEnrollmentFeedback").textContent, /copia/i);
  });
  await t.test("failed loading has a retry and cannot leave an old download active", async () => {
    const f = fixture(); install(f);
    let fail = true;
    f.app.api = async () => { if (fail) throw new Error("offline"); return f.data; };
    await createCustomerEnrollment(f.app).load();
    assert.equal(f.app.$("#customerEnrollmentRetry").hidden, false);
    assert.equal(f.app.$("#customerEnrollmentDownload").href, "");
    assert.equal(f.app.$("#customerEnrollmentCopy").disabled, true);
    fail = false;
    await f.events.get("#customerEnrollmentRetry:click")();
    assert.equal(f.app.$("#customerEnrollmentUrl").value, f.data.registration_url);
  });
  await t.test("late requests and actions cannot reveal or copy another session's invitation", async () => {
    const f = fixture(); install(f);
    let release = _value => {};
    f.app.api = () => new Promise(resolve => { release = resolve; });
    const pending = createCustomerEnrollment(f.app).load();
    f.changeEpoch();
    release(f.data); await pending;
    assert.equal(f.app.$("#customerEnrollmentUrl").value, "");
    await f.events.get("#customerEnrollmentCopy:click")();
    assert.deepEqual(f.copied, []);
    let prevented = false;
    f.events.get("#customerEnrollmentDownload:click")({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  });
  await t.test("a staff tenant change without an epoch event still discards the old response", async () => {
    const f = fixture(); install(f);
    let release = _value => {};
    f.app.api = () => new Promise(resolve => { release = resolve; });
    const pending = createCustomerEnrollment(f.app).load();
    f.app.state.currentStaff.business_id = "business-two";
    release(f.data); await pending;
    assert.equal(f.app.$("#customerEnrollmentUrl").value, "");
  });
  await t.test("manager and mismatched response scopes cannot activate invitation actions", async () => {
    const f = fixture(); install(f);
    f.app.state.currentStaff.role = "MANAGER";
    const panel = createCustomerEnrollment(f.app);
    await panel.load();
    assert.deepEqual(f.calls, []);
    f.app.state.currentStaff.role = "OWNER";
    f.data.business.id = "foreign";
    await panel.load();
    assert.equal(f.app.$("#customerEnrollmentUrl").value, "");
    assert.equal(f.app.$("#customerEnrollmentCopy").disabled, true);
  });
  await t.test("QR loading failure offers retry while preserving the usable share link", async () => {
    const f = fixture(); install(f);
    await createCustomerEnrollment(f.app).load();
    f.events.get("#customerEnrollmentQr:error")();
    assert.equal(f.app.$("#customerEnrollmentRetry").hidden, false);
    assert.equal(f.app.$("#customerEnrollmentQr").hidden, true);
    await f.events.get("#customerEnrollmentCopy:click")();
    assert.deepEqual(f.copied, [f.data.registration_url]);
    await f.events.get("#customerEnrollmentRetry:click")();
    f.events.get("#customerEnrollmentQr:load")();
    assert.equal(f.app.$("#customerEnrollmentQr").hidden, false);
  });
  await t.test("leaving the page clears the invitation before a cached page can restore it", async () => {
    const f = fixture(); install(f);
    await createCustomerEnrollment(f.app).load();
    f.events.get("window:pagehide")();
    assert.equal(f.app.$("#customerEnrollmentUrl").value, "");
    assert.equal(f.app.$("#customerEnrollmentDownload").href, "");
  });
});
