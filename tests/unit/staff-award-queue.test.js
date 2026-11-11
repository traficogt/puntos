import test from "node:test";
import assert from "node:assert/strict";
import { createAwardQueue } from "../../public/staff/award-queue.js";

const scope = { businessId: "business-a", staffId: "staff-a" };
function fixture(overrides = {}) {
  const rows = new Map(), calls = [], order = [];
  let online = true;
  const store = {
    addAward: async (row) => { order.push("stored"); rows.set(row.txId, row); },
    listAwards: async (filter) => [...rows.values()].filter((row) => row.businessId === filter.businessId && row.staffId === filter.staffId),
    updateAward: async (id, patch) => { Object.assign(rows.get(id), patch); },
    deleteAward: async (id) => { rows.delete(id); }
  };
  const deps = {
    store, isOnline: () => online, authenticate: async () => scope,
    api: async (path, options) => {
      const payload = JSON.parse(options.body); calls.push({ path, payload }); order.push("sent");
      return path.endsWith("/sync") ? { results: payload.awards.map(({ txId }) => ({ txId, ok: true })) } : { customerId: "customer-a", pointsAwarded: 5, newBalance: 10 };
    },
    ...overrides
  };
  return { queue: createAwardQueue(deps), rows, store, calls, order, setOnline: (value) => { online = value; } };
}
const award = (txId = "tx-1") => ({ txId, customerQrToken: "verified-token", amount_q: 50, visits: 1, items: 1, client_ts: "2026-11-09T10:00:00Z", meta: { ui: "staff" } });

test("online awards are committed to storage before sending and removed only after acknowledgment", async () => {
  const f = fixture();
  const result = await f.queue.submit(award(), scope);
  assert.deepEqual(f.order, ["stored", "sent"]);
  assert.equal(result.queued, false);
  assert.equal(f.rows.size, 0);
});
test("offline awards retain stable IDs and account scope", async () => {
  const f = fixture(); f.setOnline(false);
  assert.equal((await f.queue.submit(award(), scope)).queued, true);
  assert.equal(f.rows.get("tx-1").businessId, scope.businessId);
  assert.equal(f.rows.get("tx-1").staffId, scope.staffId);
  assert.equal(f.calls.length, 0);
});
test("storage failures prevent sending an unrecorded award", async () => {
  const f = fixture();
  f.store.addAward = async () => { throw new Error("QuotaExceededError"); };
  await assert.rejects(() => f.queue.submit(award(), scope), /guardar|almacenamiento/i);
  assert.equal(f.calls.length, 0);
});
test("lost acknowledgments keep the original ID for retry", async () => {
  const f = fixture({ api: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(() => f.queue.submit(award(), scope));
  assert.equal(f.rows.size, 1);
  assert.equal(f.rows.get("tx-1").txId, "tx-1");
});
test("a network-looking online browser can persist a sale while session validation is unavailable without sending it", async () => {
  const f = fixture({ canSend: () => false });
  const result = await f.queue.submit(award(), scope);
  assert.equal(result.queued, true);
  assert.equal(f.rows.size, 1);
  assert.equal(f.calls.length, 0);
});
test("synchronization sends sequential chunks of 100 and strips account/storage metadata", async () => {
  const f = fixture();
  for (let i = 0; i < 251; i++) f.rows.set(`tx-${i}`, { ...award(`tx-${i}`), ...scope, status: "queued", retry_count: 2 });
  const result = await f.queue.sync();
  assert.equal(result.synced, 251);
  assert.deepEqual(f.calls.map(({ payload }) => payload.awards.length), [100, 100, 51]);
  for (const { payload } of f.calls) for (const row of payload.awards) {
    assert.equal(Object.hasOwn(row, "businessId"), false);
    assert.equal(Object.hasOwn(row, "staffId"), false);
    assert.equal(Object.hasOwn(row, "status"), false);
    assert.equal(Object.hasOwn(row, "retry_count"), false);
  }
  assert.equal(f.rows.size, 0);
});
test("simultaneous sync triggers share one operation", async () => {
  const f = fixture(); f.rows.set("tx-1", { ...award(), ...scope });
  await Promise.all([f.queue.sync(), f.queue.sync(), f.queue.sync()]);
  assert.equal(f.calls.length, 1);
});
test("foreign account and legacy rows are never sent", async () => {
  const f = fixture();
  f.rows.set("current", { ...award("current"), ...scope });
  f.rows.set("foreign", { ...award("foreign"), businessId: "other", staffId: "other" });
  f.rows.set("legacy", award("legacy"));
  await f.queue.sync();
  assert.deepEqual(f.calls[0].payload.awards.map(({ txId }) => txId), ["current"]);
  assert.equal(f.rows.size, 2);
});
test("authentication failure halts awards and synchronization", async () => {
  const f = fixture({ authenticate: async () => null });
  f.rows.set("tx-1", { ...award(), ...scope });
  await assert.rejects(() => f.queue.submit(award("tx-2"), scope), /sesión|cuenta/i);
  await f.queue.sync();
  assert.equal(f.calls.length, 0);
  assert.equal(f.rows.size, 1);
});
test("an account switch during submission cannot assign an award to the new account", async () => {
  const f = fixture({ authenticate: async () => ({ businessId: "other", staffId: "other" }) });
  await assert.rejects(() => f.queue.submit(award(), scope), /sesión|cuenta/i);
  assert.equal(f.calls.length, 0);
  assert.equal(f.rows.size, 0);
});
test("an account switch while waiting for another tab's queue lock is checked again before saving", async () => {
  let current = scope;
  const f = fixture({
    authenticate: async () => current,
    withLock: async (_scope, fn) => { current = { businessId: "other", staffId: "other" }; return fn(); }
  });
  await assert.rejects(() => f.queue.submit(award(), scope), /sesión|cuenta/i);
  assert.equal(f.rows.size, 0);
  assert.equal(f.calls.length, 0);
});
test("partial or unrelated acknowledgments cannot delete pending operations", async () => {
  const f = fixture({ api: async () => ({ results: [{ txId: "tx-1", ok: true }, { txId: "foreign", ok: true }] }) });
  f.rows.set("tx-1", { ...award(), ...scope });
  f.rows.set("tx-2", { ...award("tx-2"), ...scope });
  f.rows.set("foreign", { ...award("foreign"), businessId: "other", staffId: "other" });
  await f.queue.sync();
  assert.equal(f.rows.has("tx-1"), false);
  assert.equal(f.rows.has("tx-2"), true);
  assert.equal(f.rows.has("foreign"), true);
});
test("failed chunks stop the pass without losing later transactions", async () => {
  let calls = 0;
  const f = fixture({ api: async () => { calls++; throw new Error("NetworkError"); } });
  for (let i = 0; i < 201; i++) f.rows.set(`tx-${i}`, { ...award(`tx-${i}`), ...scope });
  await assert.rejects(() => f.queue.sync());
  assert.equal(calls, 1);
  assert.equal(f.rows.size, 201);
});
