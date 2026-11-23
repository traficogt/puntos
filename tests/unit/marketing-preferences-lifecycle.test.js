import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createSessionEpoch } from "../../public/session-epoch.js";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture.
const source = await readFile(
  new URL("../../public/marketing-preferences.js", import.meta.url),
  "utf8",
);

async function setup({ token = "" } = {}) {
  const elements = new Map(),
    events = new Map(),
    calls = [];
  const byId = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        hidden: ["preferencesContent", "preferencesRetry", "preferencesSignin"].includes(id),
        checked: false,
        disabled: false,
        textContent: "",
        dataset: {},
        addEventListener: (event, callback) => events.set(`${id}:${event}`, callback),
      });
    return elements.get(id);
  };
  const state = { epoch: "customer-a", optedIn: true, failSave: false };
  const document = {
    hidden: false,
    getElementById: byId,
    addEventListener: (event, callback) => events.set(event, callback),
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    AbortController,
    document,
    location: { origin: "https://example.test", search: token ? `?token=${token}` : "" },
    window: { addEventListener: (event, callback) => events.set(event, callback) },
    getCustomerEpoch: () => state.epoch,
    readCustomerStorage: () => "",
    createSessionEpoch,
    api: async (url, options) => {
      calls.push({ url, options });
      if (options.method) {
        if (state.failSave) throw new TypeError("Failed to fetch");
        state.optedIn = token ? false : JSON.parse(options.body).marketing_opt_in;
      }
      return { business_name: "Café de prueba", marketing_opt_in: state.optedIn };
    },
  });
  vm.runInContext(
    source.replace(/^import .*;\n/gm, "").replace(/load\(\);\s*$/, "globalThis.loaded = load();"),
    context,
  );
  await context.loaded;
  const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
  };
  const choose = (checked) => {
    byId("marketingOptIn").checked = checked;
    events.get("marketingOptIn:change")();
  };
  const visibility = async (hidden) => {
    document.hidden = hidden;
    events.get("visibilitychange")();
    await settle();
  };
  const save = () =>
    events.get(token ? "unsubscribeButton:click" : "preferencesForm:submit")({
      preventDefault() {},
    });
  return { byId, events, state, calls, choose, visibility, save, settle };
}

test("another tab changing the customer session reloads the preferences; unrelated keys do not", async () => {
  const h = await setup();
  assert.equal(h.calls.length, 1);
  h.events.get("storage")({ key: "pf_unrelated", newValue: "1" });
  await h.settle();
  assert.equal(h.calls.length, 1);
  for (const key of ["pf_customer_epoch", "pf_customer_identity", "pf_customer_blocked", null]) {
    h.events.get("storage")({ key, newValue: null });
    await h.settle();
  }
  assert.equal(h.calls.length, 5);
});

test("unsubscribe links ignore customer session storage events", async () => {
  const h = await setup({ token: "fixture-unsubscribe" });
  h.events.get("storage")({ key: "pf_customer_epoch", newValue: "other" });
  h.events.get("storage")({ key: null, newValue: null });
  await h.settle();
  assert.equal(h.calls.length, 1);
});

test("switching tabs preserves an unsaved preference after revalidating the same customer", async () => {
  const h = await setup();
  h.choose(false);
  await h.visibility(true);
  assert.equal(h.byId("preferencesContent").hidden, true);
  let warnedWhileHidden = false;
  h.events.get("beforeunload")({
    preventDefault() {
      warnedWhileHidden = true;
    },
  });
  assert.equal(warnedWhileHidden, true, "closing a background tab must still warn about its draft");
  await h.visibility(false);
  assert.equal(h.calls.length, 2, "returning to the page must revalidate the session");
  assert.equal(h.byId("marketingOptIn").checked, false);
  let warned = false;
  h.events.get("beforeunload")({
    preventDefault() {
      warned = true;
    },
  });
  assert.equal(warned, true, "the restored choice is still an unsaved draft");
  await h.save();
  assert.equal(h.state.optedIn, false);
});

test("an unsaved preference never follows a changed customer session", async () => {
  const h = await setup();
  h.choose(false);
  await h.visibility(true);
  h.state.epoch = "customer-b";
  await h.visibility(false);
  assert.equal(h.byId("marketingOptIn").checked, true);
  let warned = false;
  h.events.get("beforeunload")({
    preventDefault() {
      warned = true;
    },
  });
  assert.equal(warned, false);
});

for (const token of ["", "fixture-unsubscribe"]) {
  test(`a failed ${token ? "unsubscribe" : "preference save"} exposes a working recheck action`, async () => {
    const h = await setup({ token });
    h.choose(false);
    h.state.failSave = true;
    await h.save();
    assert.match(h.byId("preferencesStatus").textContent, /Vuelve a consultar/);
    assert.equal(h.byId("preferencesRetry").hidden, false);
    await h.events.get("preferencesRetry:click")();
    assert.equal(h.byId("marketingOptIn").checked, true);
    assert.equal(h.byId("preferencesRetry").hidden, true);
    h.state.failSave = false;
    h.choose(false);
    await h.save();
    assert.equal(h.state.optedIn, false);
  });
}
