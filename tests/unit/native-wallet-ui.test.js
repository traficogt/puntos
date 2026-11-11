import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNativeWallet } from "../../public/customer/native-wallet.js";

function harness({ providers = { apple: true, google: true }, passes = [], online = true } = {}) {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, disabled: false, textContent: "", dataset: {}, onclick: null,
      classList: { toggle() {} }, setAttribute() {}, focus() {}
    });
    return elements.get(id);
  };
  const calls = [], navigations = [];
  let current = true;
  let mutation = async (path) => ({ url: path.endsWith("apple") ? "/api/customer/wallet/apple/download" : "https://pay.google.com/gp/v/save/header.payload.signature" });
  const deps = {
    $, identity: { businessId: "business-one", customerId: "customer-one" },
    isCurrent: () => current, isOnline: () => online,
    navigate: (url) => navigations.push(url),
    api: async (path, options) => {
      calls.push({ path, options });
      return options ? mutation(path) : { providers, passes };
    }
  };
  return { deps, $, calls, navigations, setCurrent: value => { current = value; }, setOnline: value => { online = value; }, setMutation: fn => { mutation = fn; } };
}

test("native wallet controls reflect configured providers without saving links locally", async () => {
  const h = harness({ providers: { apple: true, google: false } });
  await renderNativeWallet(h.deps, true);
  assert.equal(h.$("#billeteras").hidden, false);
  assert.equal(h.$("#btnAppleWallet").hidden, false);
  assert.equal(h.$("#btnGoogleWallet").hidden, true);
  assert.equal(h.$("#btnRevokeWallet").hidden, true);
  await h.$("#btnAppleWallet").onclick();
  assert.deepEqual(h.navigations, ["/api/customer/wallet/apple/download"]);
  assert.deepEqual(h.calls[1], { path: "/api/customer/wallet/apple", options: { method: "POST", body: "{}" } });
});

test("unconfigured providers and unknown offline readiness leave the section hidden", async () => {
  for (const live of [true, false]) {
    const h = harness({ providers: { apple: false, google: false } });
    await renderNativeWallet(h.deps, live);
    assert.equal(h.$("#billeteras").hidden, true);
    if (!live) assert.equal(h.calls.length, 0);
  }
});

test("existing passes remain revocable when both issuing providers are unavailable", async () => {
  const h = harness({ providers: { apple: false, google: false }, passes: [{ provider: "apple", created_at: "2026-11-01T00:00:00Z" }] });
  await renderNativeWallet(h.deps, true);
  assert.equal(h.$("#billeteras").hidden, false);
  assert.equal(h.$("#btnRevokeWallet").hidden, false);
  assert.equal(h.$("#btnAppleWallet").hidden, true);
  assert.equal(h.$("#btnGoogleWallet").hidden, true);
  assert.equal(h.$("#nativeWalletActions").hidden, true);
  assert.match(h.$("#nativeWalletDescription").textContent, /desactivarlas/);
});

test("provider failures stay hidden and expired sessions propagate for logout cleanup", async () => {
  const h = harness();
  await renderNativeWallet({ ...h.deps, api: async () => { throw new Error("not enabled"); } }, true);
  assert.equal(h.$("#billeteras").hidden, true);
  await assert.rejects(renderNativeWallet({ ...h.deps, api: async () => { throw Object.assign(new Error("expired"), { status: 401 }); } }, true), /expired/);
});

test("late status and issue responses cannot reveal controls or navigate after logout", async () => {
  const h = harness();
  await renderNativeWallet({ ...h.deps, api: async () => { h.setCurrent(false); return { providers: { apple: true } }; } }, true);
  assert.equal(h.$("#billeteras").hidden, true);
  h.setCurrent(true);
  await renderNativeWallet(h.deps, true);
  h.setMutation(async () => { h.setCurrent(false); return { url: "https://pay.google.com/gp/v/save/header.payload.signature" }; });
  await h.$("#btnGoogleWallet").onclick();
  assert.deepEqual(h.navigations, []);
});

test("returned URLs are restricted to the authenticated Apple download and Google's save endpoint", async () => {
  for (const provider of ["Apple", "Google"]) {
    // eslint-disable-next-line no-script-url -- Ensure an unsafe response URL is rejected.
    for (const url of ["https://example.test/steal", "javascript:alert(1)", "//pay.google.com/gp/v/save/header.payload.signature", "https://pay.google.com.attacker.test/gp/v/save/header.payload.signature", "/api/customer/wallet/apple/download?token=secret"]) {
      const h = harness();
      await renderNativeWallet(h.deps, true);
      h.setMutation(async () => ({ url }));
      await h.$(`#btn${provider}Wallet`).onclick();
      assert.deepEqual(h.navigations, []);
      assert.match(h.$("#nativeWalletStatus").textContent, /No pudimos/);
    }
  }
});

test("offline state disables issuance and explains the saved card's last online balance", async () => {
  const h = harness();
  await renderNativeWallet(h.deps, true);
  h.setOnline(false);
  await renderNativeWallet(h.deps, false);
  assert.equal(h.$("#billeteras").hidden, false);
  assert.equal(h.$("#btnAppleWallet").disabled, true);
  assert.equal(h.$("#btnGoogleWallet").disabled, true);
  assert.match(h.$("#nativeWalletStatus").textContent, /guardada.*sin conexión/);
  assert.match(h.$("#nativeWalletStatus").textContent, /saldo.*conexión/);
});

test("revocation requires explicit confirmation and cancellation sends no mutation", async () => {
  const h = harness({ passes: [{ provider: "apple", created_at: "2026-11-01T00:00:00Z" }] });
  await renderNativeWallet(h.deps, true);
  assert.equal(h.$("#btnRevokeWallet").hidden, false);
  await h.$("#btnRevokeWallet").onclick();
  assert.equal(h.$("#nativeWalletConfirm").hidden, false);
  assert.equal(h.calls.length, 1);
  h.$("#btnCancelRevokeWallet").onclick();
  assert.equal(h.$("#nativeWalletConfirm").hidden, true);
  assert.equal(h.calls.length, 1);
  await h.$("#btnRevokeWallet").onclick();
  h.setMutation(async () => ({ ok: true }));
  await h.$("#btnConfirmRevokeWallet").onclick();
  assert.deepEqual(h.calls[1], { path: "/api/customer/wallet/revoke", options: { method: "POST", body: "{}" } });
  assert.match(h.$("#nativeWalletStatus").textContent, /desactivadas/);
  assert.equal(h.$("#btnRevokeWallet").hidden, true);
});

test("repeated clicks share the active operation and cannot issue twice", async () => {
  const h = harness();
  await renderNativeWallet(h.deps, true);
  let complete = (_value) => {};
  h.setMutation(() => new Promise(resolve => { complete = resolve; }));
  const pending = h.$("#btnGoogleWallet").onclick();
  await h.$("#btnGoogleWallet").onclick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.$("#btnAppleWallet").disabled, true);
  complete({ url: "https://pay.google.com/gp/v/save/header.payload.signature" });
  await pending;
  assert.deepEqual(h.navigations, ["https://pay.google.com/gp/v/save/header.payload.signature"]);
});

test("routine balance refresh preserves an open revocation confirmation", async () => {
  const h = harness({ passes: [{ provider: "apple", created_at: "2026-11-01T00:00:00Z" }] });
  await renderNativeWallet(h.deps, true);
  h.$("#btnRevokeWallet").onclick();
  await renderNativeWallet(h.deps, true);
  assert.equal(h.$("#nativeWalletConfirm").hidden, false);
  assert.equal(h.calls.length, 1);
});

test("logout cleanup invalidates a pending action even if a later login uses the same customer", async () => {
  const h = harness();
  await renderNativeWallet(h.deps, true);
  let complete = (_value) => {};
  h.setMutation(() => new Promise(resolve => { complete = resolve; }));
  const pending = h.$("#btnGoogleWallet").onclick();
  h.$("#billeteras").hidden = true;
  h.$("#billeteras").dataset.nativeWalletOwner = "";
  await renderNativeWallet(h.deps, true);
  complete({ url: "https://pay.google.com/gp/v/save/header.payload.signature" });
  await pending;
  assert.deepEqual(h.navigations, []);
});
