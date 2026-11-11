import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { awardPointsWithDeps } from "../../src/app/services/staff-award-service.js";

const staff = { id: "s1", business_id: "b1", branch_id: null, role: "OWNER" };
const decoded = { bid: "b1", cid: "c1", jti: "j1", exp: 123, iat: 100 };
const args = { staff, customerQrToken: "signed-token", txId: "tx-1", amount_q: 10, visits: 1, items: 1 };
const fingerprint = crypto.createHash("sha256").update(JSON.stringify(["b1", "c1", "s1", "j1", 10, 1, 1])).digest("hex");
function fixture({ expired = true, stored = true, changed = {} } = {}) {
  let inserts = 0;
  const deps = {
    verifyQrToken: async () => { if (expired) throw new Error("QR expired"); return decoded; },
    verifyQrSignature: async () => decoded,
    BusinessRepo: { getById: async () => ({ id: "b1", plan: "EMPRESA", program_json: {} }), activeCustomerCount: async () => 0 },
    planLimits: () => ({ activeCustomers: 1000 }), computePoints: () => 10,
    withTransaction: async (fn) => fn({ query: async (sql) => {
      if (sql.includes("FROM transactions")) return { rows: stored ? [{ id: "tx-1", business_id: "b1", customer_id: "c1", staff_user_id: "s1", amount_q: 10, visits: 1, items: 1, points: 10, status: "POSTED", meta: { staff_request_fingerprint: fingerprint }, ...changed }] : [] };
      if (sql.includes("FROM customer_balances")) return { rows: [{ points: 10, pending_points: 0 }] };
      if (sql.includes("INSERT")) inserts++;
      return { rows: [], rowCount: 0 };
    } }),
    enqueueWebhookEvent: async () => {}
  };
  return { deps, get inserts() { return inserts; } };
}

test("lost response can be acknowledged after QR expiry without issuing more points", async () => {
  const f = fixture();
  const out = await awardPointsWithDeps(f.deps, args);
  assert.equal(out.replay, true); assert.equal(out.transactionId, "tx-1"); assert.equal(f.inserts, 0);
});
test("expired QR cannot create a new award through the replay path", async () => {
  const f = fixture({ stored: false });
  await assert.rejects(awardPointsWithDeps(f.deps, args), /expired/); assert.equal(f.inserts, 0);
});
test("changing the amount, quantity or staff on a retry is rejected", async () => {
  for (const expired of [false, true]) for (const patch of [{ amount_q: 99 }, { items: 2 }, { visits: 2 }, { staff: { ...staff, id: "other" } }]) {
    const f = fixture({ expired });
    await assert.rejects(awardPointsWithDeps(f.deps, { ...args, ...patch }), { statusCode: 409 });
    assert.equal(f.inserts, 0);
  }
});
test("legacy transaction replay still compares stored financial fields", async () => {
  const f = fixture({ changed: { meta: {} } });
  assert.equal((await awardPointsWithDeps(f.deps, args)).replay, true);
  await assert.rejects(awardPointsWithDeps(f.deps, { ...args, amount_q: 11 }), { statusCode: 409 });
});

test("unsafe computed points and fractional currency fail before ledger writes", async () => {
  for (const points of [2147483648, Infinity, NaN, -1]) {
    const f = fixture({ expired: false, stored: false });
    f.deps.computePoints = () => points;
    await assert.rejects(awardPointsWithDeps(f.deps, args), { statusCode: 400 });
    assert.equal(f.inserts, 0);
  }
  const f = fixture({ expired: false, stored: false });
  await assert.rejects(awardPointsWithDeps(f.deps, { ...args, amount_q: 1.234 }), { statusCode: 400 });
  assert.equal(f.inserts, 0);
});
