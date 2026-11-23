import test from "node:test";
import assert from "node:assert/strict";

let fixtureId = 0;
const originalIdentity = { businessId: "business-one", customerId: "customer-one", slug: "cafe" };
const nextIdentity = { businessId: "business-two", customerId: "customer-two", slug: "panaderia" };

async function setup(t, mode = "normal") {
  const saved = new Map([
    ["pf_customer_epoch", "previous-epoch"],
    ["pf_customer_identity", JSON.stringify(originalIdentity)],
    ["pf_phone", "50212345678"],
  ]);
  const state = { mode };
  const denied = () => {
    throw new Error("Storage unavailable");
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        if (state.mode === "denied") return denied();
        return saved.get(key) || null;
      },
      setItem(key, value) {
        if (state.mode !== "normal") return denied();
        saved.set(key, value);
        return undefined;
      },
      removeItem(key) {
        if (state.mode === "denied" || state.mode === "readonly") return denied();
        saved.delete(key);
        return undefined;
      },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  });
  const session = await import(`../../public/customer/session.js?storage-fixture=${fixtureId++}`);
  return { saved, state, session };
}

test("quota failures still invalidate pending responses, clear identity, and block the wallet", async (t) => {
  const { saved, session } = await setup(t, "quota");
  const before = session.getCustomerEpoch();
  session.invalidateCustomerIdentity({ block: true });
  const after = session.getCustomerEpoch();
  assert.notEqual(after, before);
  assert.equal(session.getCustomerEpoch(), after);
  assert.equal(session.getCustomerIdentity(), null);
  assert.equal(session.readCustomerStorage("pf_phone"), "");
  assert.equal(session.readCustomerStorage("pf_customer_blocked"), "1");
  assert.equal(saved.has("pf_customer_identity"), false);
  assert.equal(saved.has("pf_phone"), false);
});

test("a complete storage denial keeps logout blocked in memory until fresh verification", async (t) => {
  const { state, session } = await setup(t, "denied");
  const before = session.getCustomerEpoch();
  session.invalidateCustomerIdentity({ block: true });
  const after = session.getCustomerEpoch();
  assert.notEqual(after, before);
  assert.equal(session.getCustomerIdentity(), null);
  assert.equal(session.readCustomerStorage("pf_customer_blocked"), "1");
  state.mode = "normal";
  assert.equal(session.getCustomerEpoch(), after);
  assert.equal(session.getCustomerIdentity(), null);
  assert.equal(session.readCustomerStorage("pf_customer_blocked"), "1");
  session.invalidateCustomerIdentity();
  assert.equal(session.readCustomerStorage("pf_customer_blocked"), "");
});

test("failed cleanup cannot expose the old identity and verified identity remains usable in memory", async (t) => {
  const { saved, session } = await setup(t, "readonly");
  session.invalidateCustomerIdentity({ block: true });
  assert.equal(saved.has("pf_customer_identity"), true);
  assert.equal(session.getCustomerIdentity(), null);
  assert.equal(session.readCustomerStorage("pf_phone"), "");
  session.invalidateCustomerIdentity();
  session.rememberCustomerIdentity({
    business: { id: nextIdentity.businessId, slug: nextIdentity.slug },
    customer: { id: nextIdentity.customerId },
  });
  assert.deepEqual(session.getCustomerIdentity(), nextIdentity);
  assert.equal(session.readCustomerStorage("pf_customer_blocked"), "");
});

test("a later tab's verified session supersedes a failed-write logout fallback", async (t) => {
  const { saved, session } = await setup(t, "readonly");
  session.invalidateCustomerIdentity({ block: true });
  saved.set("pf_customer_epoch", "other-tab-login");
  saved.set("pf_customer_identity", JSON.stringify(nextIdentity));
  saved.delete("pf_customer_blocked");
  assert.equal(session.readCustomerStorage("pf_customer_blocked"), "");
  assert.equal(session.getCustomerEpoch(), "other-tab-login");
  assert.deepEqual(session.getCustomerIdentity(), nextIdentity);
});

test("restored writes and ordinary cross-tab logout keep the persisted epoch authoritative", async (t) => {
  const { saved, state, session } = await setup(t, "quota");
  session.invalidateCustomerIdentity({ block: true });
  state.mode = "normal";
  session.invalidateCustomerIdentity();
  session.rememberCustomerIdentity({
    business: { id: nextIdentity.businessId, slug: nextIdentity.slug },
    customer: { id: nextIdentity.customerId },
  });
  assert.equal(session.getCustomerEpoch(), saved.get("pf_customer_epoch"));
  assert.deepEqual(session.getCustomerIdentity(), nextIdentity);
  saved.set("pf_customer_epoch", "other-tab-logout");
  saved.delete("pf_customer_identity");
  saved.set("pf_customer_blocked", "1");
  assert.equal(session.getCustomerEpoch(), "other-tab-logout");
  assert.equal(session.getCustomerIdentity(), null);
  assert.equal(session.readCustomerStorage("pf_customer_blocked"), "1");
});
