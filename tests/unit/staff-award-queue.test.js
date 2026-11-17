import test from "node:test";
import assert from "node:assert/strict";
import { classifyAwardFailure, createAwardQueue } from "../../public/staff/award-queue.js";

const scope = { businessId: "business-a", staffId: "staff-a" };
function fixture(overrides = {}) {
  const rows = new Map(), calls = [], order = [];
  let online = true;
  const store = {
    addAward: async (row) => { order.push("stored"); rows.set(row.txId, row); },
    // Mirrors public/idb.js: scoped rows, optional status filter, missing status = queued.
    listAwards: async (filter) => [...rows.values()].filter((row) => row.businessId === filter.businessId && row.staffId === filter.staffId
      && (!filter.statuses || filter.statuses.includes(row.status || "queued"))),
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

const httpError = (status, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });
/** @param {string} name */
const outcome = (name) => (/** @type {any} */ error) => error?.awardOutcome === name;

test("award failures are classified by whether the server could have committed them", () => {
  for (const error of [new TypeError("Failed to fetch"), new Error("El servidor no confirmó"), httpError(408), httpError(425), httpError(429), httpError(500), httpError(502), httpError(503), httpError(504)]) {
    assert.equal(classifyAwardFailure(error), "retry", String(/** @type {any} */ (error).status ?? error.message));
  }
  assert.equal(classifyAwardFailure(httpError(401)), "held");
  for (const status of [400, 403, 404, 409, 422]) assert.equal(classifyAwardFailure(httpError(status)), "rejected", String(status));
});

test("a definitive online rejection is shown as failed and never replayed by synchronization", async () => {
  let rejectAward = true;
  const f = fixture({
    api: async (path, options) => {
      const payload = JSON.parse(options.body); f.calls.push({ path, payload });
      if (path.endsWith("/award") && rejectAward) throw httpError(409, "QR ya utilizado");
      return path.endsWith("/sync") ? { results: payload.awards.map(({ txId }) => ({ txId, ok: true })) } : { customerId: "customer-a" };
    }
  });
  await assert.rejects(() => f.queue.submit(award(), scope), outcome("rejected"));
  assert.equal(f.rows.get("tx-1").status, "rejected");
  assert.match(f.rows.get("tx-1").last_error, /QR ya utilizado/);
  rejectAward = false;
  const summary = await f.queue.sync();
  assert.equal(summary.attempted, 0);
  assert.deepEqual(f.calls.map(({ path }) => path), ["/api/staff/award"], "the rejected sale must not be resent after the cashier was told it failed");
  await f.queue.discard("tx-1");
  assert.equal(f.rows.size, 0);
});

test("per-sale sync rejections stop retrying while ambiguous failures keep their transaction ID", async () => {
  const f = fixture({
    api: async (path, options) => {
      const payload = JSON.parse(options.body); f.calls.push({ path, payload });
      return { results: payload.awards.map(({ txId }) => txId === "tx-1"
        ? { txId, ok: false, error: "Límite diario excedido", status: 409 }
        : txId === "tx-2" ? { txId, ok: false, error: "Error interno", status: 500 } : { txId, ok: false, error: "Sin estado" }) };
    }
  });
  for (const id of ["tx-1", "tx-2", "tx-3"]) f.rows.set(id, { ...award(id), ...scope, status: "queued" });
  const first = await f.queue.sync();
  assert.equal(first.rejected, 1);
  assert.equal(f.rows.get("tx-1").status, "rejected");
  assert.equal(f.rows.get("tx-2").status, "queued");
  assert.equal(f.rows.get("tx-3").status, "queued", "a result without a status is ambiguous and stays pending");
  await f.queue.sync();
  assert.deepEqual(f.calls[1].payload.awards.map(({ txId }) => txId), ["tx-2", "tx-3"]);
});

test("server errors and lost responses stay pending and are resent with the same transaction ID", async () => {
  let failures = [httpError(500, "Error interno"), new TypeError("Failed to fetch")];
  const f = fixture({
    api: async (path, options) => {
      const payload = JSON.parse(options.body); f.calls.push({ path, payload });
      const failure = failures.shift();
      if (failure) throw failure;
      return { results: payload.awards.map(({ txId }) => ({ txId, ok: true })) };
    }
  });
  await assert.rejects(() => f.queue.submit(award(), scope), outcome("retry"));
  assert.equal(f.rows.get("tx-1").status, "queued");
  assert.match(f.rows.get("tx-1").last_error, /se reintentará/);
  await assert.rejects(() => f.queue.sync());
  assert.equal(f.rows.get("tx-1").status, "queued");
  await f.queue.sync();
  assert.equal(f.rows.size, 0);
  assert.deepEqual(f.calls.map(({ payload }) => payload.txId ?? payload.awards[0].txId), ["tx-1", "tx-1", "tx-1"]);
});

test("an expired session holds the sale until the cashier explicitly retries or discards it", async () => {
  let expired = true;
  const f = fixture({
    api: async (path, options) => {
      const payload = JSON.parse(options.body); f.calls.push({ path, payload });
      if (expired) throw httpError(401, "No autenticado");
      return { results: payload.awards.map(({ txId }) => ({ txId, ok: true })) };
    }
  });
  await assert.rejects(() => f.queue.submit(award("tx-1"), scope), outcome("held"));
  await assert.rejects(() => f.queue.submit(award("tx-2"), scope), outcome("held"));
  expired = false;
  assert.equal((await f.queue.sync()).attempted, 0);
  assert.equal(f.calls.length, 2, "a later session must not silently replay held sales");
  const result = await f.queue.retry("tx-1");
  assert.equal(result.synced, 1);
  assert.equal(f.calls.at(-1).payload.awards.length, 1);
  assert.equal(f.calls.at(-1).payload.awards[0].txId, "tx-1");
  assert.equal(f.rows.has("tx-1"), false);
  await f.queue.discard("tx-2");
  assert.equal(f.rows.size, 0);
});

test("legacy failed rows and whole-batch refusals require a cashier decision", async () => {
  let refuse = true;
  const f = fixture({
    api: async (path, options) => {
      const payload = JSON.parse(options.body); f.calls.push({ path, payload });
      if (refuse) throw httpError(403, "Permiso insuficiente");
      return { results: payload.awards.map(({ txId }) => ({ txId, ok: true })) };
    }
  });
  f.rows.set("legacy-failed", { ...award("legacy-failed"), ...scope, status: "failed" });
  f.rows.set("tx-1", { ...award("tx-1"), ...scope, status: "queued" });
  await assert.rejects(() => f.queue.sync(), outcome("held"));
  assert.deepEqual(f.calls[0].payload.awards.map(({ txId }) => txId), ["tx-1"], "legacy failed rows are not replayed automatically");
  assert.equal(f.rows.get("tx-1").status, "held");
  refuse = false;
  assert.equal((await f.queue.sync()).attempted, 0);
  assert.equal(f.calls.length, 1);
  await f.queue.retry("legacy-failed");
  assert.equal(f.rows.has("legacy-failed"), false);
  assert.equal(f.rows.get("tx-1").status, "held");
});

test("decisions only apply to rows awaiting one in the current account", async () => {
  const f = fixture();
  f.rows.set("queued", { ...award("queued"), ...scope, status: "queued" });
  f.rows.set("foreign", { ...award("foreign"), businessId: "other", staffId: "other", status: "rejected" });
  await assert.rejects(() => f.queue.discard("queued"), /ya no espera una decisión/);
  await assert.rejects(() => f.queue.discard("foreign"), /ya no espera una decisión/);
  await assert.rejects(() => f.queue.retry("foreign"), /ya no espera una decisión/);
  assert.equal(f.rows.size, 2);
  const signedOut = fixture({ authenticate: async () => null });
  signedOut.rows.set("held", { ...award("held"), ...scope, status: "held" });
  await assert.rejects(() => signedOut.queue.discard("held"), /Inicia sesión/);
  assert.equal(signedOut.rows.size, 1);
});
