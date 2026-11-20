import { test } from "node:test";
import assert from "node:assert/strict";
import { accrueCashback, spendCashback, getCashbackBalance } from "../../src/app/services/cashback-service.js";

const r2 = (n) => Math.round(Number(n) * 100) / 100;

// A minimal in-memory stand-in for the cashback_accounts row + the
// (business_id, request_id) unique index, enough to exercise the service's
// balance math and idempotency without a real database.
function mockClient() {
  const account = { balance_q: 0, lifetime_earned_q: 0, lifetime_spent_q: 0, exists: false };
  const seen = new Map(); // request_id -> balance_after_q
  return {
    account,
    seen,
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO cashback_accounts")) {
        account.exists = true;
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("FROM cashback_accounts") && sql.includes("FOR UPDATE")) {
        return { rowCount: 1, rows: [{ balance_q: account.balance_q }] };
      }
      if (sql.includes("INSERT INTO cashback_transactions")) {
        const reqId = params[4];
        if (seen.has(reqId)) return { rowCount: 0, rows: [] };
        seen.set(reqId, params[6]); // balance_after_q
        return { rowCount: 1, rows: [{ id: params[0] }] };
      }
      if (sql.includes("SELECT balance_after_q FROM cashback_transactions")) {
        const reqId = params[1];
        if (!seen.has(reqId)) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ balance_after_q: seen.get(reqId) }] };
      }
      if (sql.includes("SET balance_q = balance_q + $2")) {
        account.balance_q = r2(account.balance_q + params[1]);
        account.lifetime_earned_q = r2(account.lifetime_earned_q + params[1]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("SET balance_q = balance_q - $2")) {
        account.balance_q = r2(account.balance_q - params[1]);
        account.lifetime_spent_q = r2(account.lifetime_spent_q + params[1]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("balance_q, lifetime_earned_q")) {
        if (!account.exists) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ balance_q: account.balance_q, lifetime_earned_q: account.lifetime_earned_q, lifetime_spent_q: account.lifetime_spent_q }] };
      }
      throw new Error("unexpected SQL: " + sql.slice(0, 60));
    }
  };
}

const base = { businessId: "b1", customerId: "c1" };

test("accrueCashback: credits the earned amount and raises the balance", async () => {
  const c = mockClient();
  const out = await accrueCashback(c, { ...base, amountQ: 100, earnQ: 5, requestId: "tx-1" });
  assert.deepEqual(out, { earn_q: 5, balance_after_q: 5 });
  assert.equal(c.account.balance_q, 5);
  assert.equal(c.account.lifetime_earned_q, 5);
});

test("accrueCashback: is idempotent on the source transaction (no double credit)", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 100, earnQ: 5, requestId: "tx-1" });
  const replay = await accrueCashback(c, { ...base, amountQ: 100, earnQ: 5, requestId: "tx-1" });
  assert.equal(replay.replay, true);
  assert.equal(c.account.balance_q, 5); // unchanged
});

test("accrueCashback: nothing to earn returns null", async () => {
  const c = mockClient();
  assert.equal(await accrueCashback(c, { ...base, amountQ: 1, earnQ: 0, requestId: "tx-0" }), null);
  assert.equal(c.account.balance_q, 0);
});

test("spendCashback: debits the balance", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 200, earnQ: 10, requestId: "tx-1" });
  const out = await spendCashback(c, { ...base, amountQ: 7, requestId: "sp-1" });
  assert.deepEqual(out, { spent_q: 7, balance_after_q: 3 });
  assert.equal(c.account.balance_q, 3);
  assert.equal(c.account.lifetime_spent_q, 7);
});

test("spendCashback: is idempotent on the request id", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 200, earnQ: 10, requestId: "tx-1" });
  await spendCashback(c, { ...base, amountQ: 7, requestId: "sp-1" });
  const replay = await spendCashback(c, { ...base, amountQ: 7, requestId: "sp-1" });
  assert.equal(replay.replay, true);
  assert.equal(c.account.balance_q, 3); // debited once
});

test("spendCashback: rejects an amount above the balance", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 100, earnQ: 5, requestId: "tx-1" });
  await assert.rejects(() => spendCashback(c, { ...base, amountQ: 9, requestId: "sp-x" }), /insuficiente/i);
  assert.equal(c.account.balance_q, 5); // untouched
});

test("spendCashback: rejects a non-positive amount", async () => {
  const c = mockClient();
  await assert.rejects(() => spendCashback(c, { ...base, amountQ: 0, requestId: "sp-z" }), /mayor que cero/i);
});

test("getCashbackBalance: zero when there is no account yet", async () => {
  const c = mockClient();
  assert.deepEqual(await getCashbackBalance(c, "c1"), { balance_q: 0, lifetime_earned_q: 0, lifetime_spent_q: 0 });
});
