import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadStoredValue,
  transferStoredValue,
  spendCashback,
} from "../../src/app/services/cashback-service.js";

const r2 = (n) => Math.round(Number(n) * 100) / 100;

// In-memory stand-in for multiple cashback_accounts rows + the
// (business_id, request_id) idempotency index, enough to exercise the
// gift-card load/transfer/spend math without a database. NUMERIC columns come
// back as strings, as pg returns them; NUMERIC params are coerced like Postgres.
function mockDb(initial = {}) {
  const accounts = {}; // customerId -> { balance_q, lifetime_earned_q, lifetime_spent_q }
  const txSeen = new Map(); // request_id -> { tx_type, amount_q, balance_after_q }
  const acct = (cid) =>
    (accounts[cid] ??= { balance_q: 0, lifetime_earned_q: 0, lifetime_spent_q: 0 });
  for (const [cid, bal] of Object.entries(initial)) acct(cid).balance_q = bal;
  return {
    accounts,
    txSeen,
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO cashback_accounts")) {
        acct(params[0]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("FROM cashback_accounts") && sql.includes("FOR UPDATE")) {
        return { rowCount: 1, rows: [{ balance_q: acct(params[0]).balance_q.toFixed(2) }] };
      }
      if (sql.includes("FROM cashback_transactions") && sql.includes("TRANSFER_OUT")) {
        const row = txSeen.get(params[1]);
        return row && row.tx_type === "TRANSFER_OUT"
          ? { rowCount: 1, rows: [{ balance_after_q: row.balance_after_q }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes("FROM cashback_transactions") && sql.includes("request_id = $2")) {
        const row = txSeen.get(params[1]);
        return row
          ? {
              rowCount: 1,
              rows: [
                {
                  tx_type: row.tx_type,
                  customer_id: row.customer_id,
                  balance_after_q: row.balance_after_q,
                },
              ],
            }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes("INSERT INTO cashback_transactions")) {
        // TRANSFER_* inserts hardcode NULL for staff_user_id, so request_id/
        // balance_after_q sit one position earlier than in accrue/spend/load.
        const isTransfer = sql.includes("'TRANSFER_OUT'") || sql.includes("'TRANSFER_IN'");
        const reqId = isTransfer ? params[3] : params[4];
        const amount = isTransfer ? params[4] : params[5];
        const balAfter = isTransfer ? params[5] : params[6];
        const txType = sql.includes("'LOAD'")
          ? "LOAD"
          : sql.includes("'TRANSFER_OUT'")
            ? "TRANSFER_OUT"
            : sql.includes("'TRANSFER_IN'")
              ? "TRANSFER_IN"
              : sql.includes("'SPEND'")
                ? "SPEND"
                : "EARN";
        if (sql.includes("ON CONFLICT") && txSeen.has(reqId)) return { rowCount: 0, rows: [] };
        txSeen.set(reqId, {
          tx_type: txType,
          customer_id: params[2],
          amount_q: amount,
          balance_after_q: balAfter,
        });
        return { rowCount: 1, rows: [{ id: params[0] }] };
      }
      if (sql.includes("SET balance_q = balance_q + $2") && sql.includes("lifetime_earned_q")) {
        const a = acct(params[0]);
        a.balance_q = r2(a.balance_q + Number(params[1]));
        a.lifetime_earned_q = r2(a.lifetime_earned_q + Number(params[1]));
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("SET balance_q = balance_q - $2")) {
        const a = acct(params[0]);
        a.balance_q = r2(a.balance_q - Number(params[1]));
        a.lifetime_spent_q = r2(a.lifetime_spent_q + Number(params[1]));
        return { rowCount: 1, rows: [] };
      }
      throw new Error("unexpected SQL: " + sql.slice(0, 70));
    },
  };
}

test("loadStoredValue: credits amount + bonus and raises the balance", async () => {
  const c = mockDb();
  const out = await loadStoredValue(c, {
    businessId: "b1",
    customerId: "c1",
    amountQ: 100,
    bonusQ: 10,
    requestId: "L1",
  });
  assert.deepEqual(out, { loaded_q: 110, base_q: 100, bonus_q: 10, balance_after_q: 110 });
  assert.equal(c.accounts.c1.balance_q, 110);
  assert.equal(c.accounts.c1.lifetime_earned_q, 110);
});

test("loadStoredValue: idempotent on requestId (no double load)", async () => {
  const c = mockDb();
  await loadStoredValue(c, {
    businessId: "b1",
    customerId: "c1",
    amountQ: 50,
    bonusQ: 0,
    requestId: "L1",
  });
  const replay = await loadStoredValue(c, {
    businessId: "b1",
    customerId: "c1",
    amountQ: 50,
    bonusQ: 0,
    requestId: "L1",
  });
  assert.equal(replay.replay, true);
  assert.equal(c.accounts.c1.balance_q, 50);
});

test("loadStoredValue: rejects a non-positive amount", async () => {
  const c = mockDb();
  await assert.rejects(
    () => loadStoredValue(c, { businessId: "b1", customerId: "c1", amountQ: 0, requestId: "L0" }),
    /mayor que cero/i,
  );
});

test("transferStoredValue: moves balance from one member to another", async () => {
  const c = mockDb({ a: 50, b: 0 });
  const out = await transferStoredValue(c, {
    businessId: "b1",
    fromCustomerId: "a",
    toCustomerId: "b",
    amountQ: 20,
    requestId: "T1",
  });
  assert.deepEqual(out, { transferred_q: 20, balance_after_q: 30 });
  assert.equal(c.accounts.a.balance_q, 30);
  assert.equal(c.accounts.b.balance_q, 20);
  assert.equal(c.accounts.a.lifetime_spent_q, 20);
  assert.equal(c.accounts.b.lifetime_earned_q, 20);
});

test("transferStoredValue: idempotent on requestId (no double transfer)", async () => {
  const c = mockDb({ a: 50, b: 0 });
  await transferStoredValue(c, {
    businessId: "b1",
    fromCustomerId: "a",
    toCustomerId: "b",
    amountQ: 20,
    requestId: "T1",
  });
  const replay = await transferStoredValue(c, {
    businessId: "b1",
    fromCustomerId: "a",
    toCustomerId: "b",
    amountQ: 20,
    requestId: "T1",
  });
  assert.equal(replay.replay, true);
  assert.equal(c.accounts.a.balance_q, 30);
  assert.equal(c.accounts.b.balance_q, 20);
});

test("transferStoredValue: rejects an amount over the sender's balance", async () => {
  const c = mockDb({ a: 10, b: 0 });
  await assert.rejects(
    () =>
      transferStoredValue(c, {
        businessId: "b1",
        fromCustomerId: "a",
        toCustomerId: "b",
        amountQ: 25,
        requestId: "T2",
      }),
    /insuficiente/i,
  );
  assert.equal(c.accounts.a.balance_q, 10);
  assert.equal(c.accounts.b.balance_q, 0);
});

test("transferStoredValue: rejects a self-transfer", async () => {
  const c = mockDb({ a: 50 });
  await assert.rejects(
    () =>
      transferStoredValue(c, {
        businessId: "b1",
        fromCustomerId: "a",
        toCustomerId: "a",
        amountQ: 5,
        requestId: "T3",
      }),
    /misma cuenta/i,
  );
});

test("spendCashback debits a gift-card-loaded balance (shared ledger)", async () => {
  const c = mockDb();
  await loadStoredValue(c, {
    businessId: "b1",
    customerId: "c1",
    amountQ: 100,
    bonusQ: 0,
    requestId: "L1",
  });
  const out = await spendCashback(c, {
    businessId: "b1",
    customerId: "c1",
    amountQ: 30,
    requestId: "S1",
  });
  assert.deepEqual(out, { spent_q: 30, balance_after_q: 70 });
  assert.equal(c.accounts.c1.balance_q, 70);
});

// ----- exact centavo arithmetic (utils/money.js) -----

test("loadStoredValue: writes fixed two-decimal strings and keeps centavos exact", async () => {
  const c = mockDb();
  const out = await loadStoredValue(c, {
    businessId: "b1",
    customerId: "c1",
    amountQ: 19.99,
    bonusQ: 2,
    requestId: "L1",
  });
  assert.deepEqual(out, { loaded_q: 21.99, base_q: 19.99, bonus_q: 2, balance_after_q: 21.99 });
  assert.equal(c.txSeen.get("L1").amount_q, "21.99");
  assert.equal(c.txSeen.get("L1").balance_after_q, "21.99");
  assert.equal(c.accounts.c1.balance_q, 21.99);
});

test("transferStoredValue: a balance built from 0.10 + 0.20 can be gifted whole (exact compare)", async () => {
  const c = mockDb();
  await loadStoredValue(c, { businessId: "b1", customerId: "a", amountQ: 0.1, requestId: "L1" });
  await loadStoredValue(c, { businessId: "b1", customerId: "a", amountQ: 0.2, requestId: "L2" });
  const out = await transferStoredValue(c, {
    businessId: "b1",
    fromCustomerId: "a",
    toCustomerId: "b",
    amountQ: 0.3,
    requestId: "T1",
  });
  assert.deepEqual(out, { transferred_q: 0.3, balance_after_q: 0 });
  assert.equal(c.accounts.a.balance_q, 0);
  assert.equal(c.accounts.b.balance_q, 0.3);
  assert.equal(c.txSeen.get("T1").amount_q, "-0.30");
  assert.equal(c.txSeen.get("T1").balance_after_q, "0.00");
});

test("transferStoredValue: rejects a gift one centavo over the balance, allows the exact balance", async () => {
  const c = mockDb({ a: 10, b: 0 });
  await assert.rejects(
    () =>
      transferStoredValue(c, {
        businessId: "b1",
        fromCustomerId: "a",
        toCustomerId: "b",
        amountQ: 10.01,
        requestId: "T2",
      }),
    /insuficiente/i,
  );
  const ok = await transferStoredValue(c, {
    businessId: "b1",
    fromCustomerId: "a",
    toCustomerId: "b",
    amountQ: 10,
    requestId: "T3",
  });
  assert.equal(ok.balance_after_q, 0);
  assert.equal(c.accounts.b.balance_q, 10);
});
