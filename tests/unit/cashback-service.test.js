import { test } from "node:test";
import assert from "node:assert/strict";
import { accrueCashback, spendCashback, reverseCashback, getCashbackBalance } from "../../src/app/services/cashback-service.js";

const r2 = (n) => Math.round(Number(n) * 100) / 100;

// A faithful in-memory stand-in for the cashback_accounts row + the
// cashback_transactions table (with the (business_id, request_id) unique index),
// enough to exercise the service's balance math, idempotency and reversal
// without a real database.
function mockClient() {
  const account = { balance_q: 0, lifetime_earned_q: 0, lifetime_spent_q: 0, exists: false };
  const txns = [];
  return {
    account,
    txns,
    async query(sql, params = []) {
      const S = String(sql).replace(/\s+/g, " ").trim();
      if (S.includes("INSERT INTO cashback_accounts")) { account.exists = true; return { rowCount: 1, rows: [] }; }
      if (S.includes("FROM cashback_accounts") && S.includes("FOR UPDATE")) { return { rowCount: 1, rows: [{ balance_q: account.balance_q }] }; }
      if (S.includes("INSERT INTO cashback_transactions")) {
        const m = S.match(/'(EARN|SPEND|LOAD|TRANSFER_OUT|TRANSFER_IN|REVERSE)'/);
        const row = { business_id: params[1], customer_id: params[2], request_id: params[4], tx_type: m ? m[1] : null, amount_q: params[5], balance_after_q: params[6], source_transaction_id: params[7] ?? null };
        if (S.includes("ON CONFLICT") && txns.some((t) => t.business_id === row.business_id && t.request_id === row.request_id)) {
          return { rowCount: 0, rows: [] };
        }
        txns.push(row);
        return { rowCount: 1, rows: [{ id: params[0] }] };
      }
      if (S.includes("COALESCE(SUM(amount_q)")) {
        const [bid, srcTx] = params;
        const earned = txns.filter((t) => t.business_id === bid && t.source_transaction_id === srcTx && t.tx_type === "EARN").reduce((s, t) => s + Number(t.amount_q), 0);
        return { rowCount: 1, rows: [{ earned_q: earned }] };
      }
      if (S.includes("source_transaction_id = $2 AND tx_type = 'REVERSE'")) {
        const [bid, srcTx] = params;
        const hit = txns.find((t) => t.business_id === bid && t.source_transaction_id === srcTx && t.tx_type === "REVERSE");
        return hit ? { rowCount: 1, rows: [{ balance_after_q: hit.balance_after_q }] } : { rowCount: 0, rows: [] };
      }
      if (S.includes("FROM cashback_transactions WHERE business_id = $1 AND request_id = $2")) {
        const [bid, reqId] = params;
        const hit = txns.find((t) => t.business_id === bid && t.request_id === reqId);
        if (!hit) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ tx_type: hit.tx_type, customer_id: hit.customer_id, balance_after_q: hit.balance_after_q }] };
      }
      if (S.includes("SET balance_q = balance_q + $2")) { account.balance_q = r2(account.balance_q + params[1]); account.lifetime_earned_q = r2(account.lifetime_earned_q + params[1]); return { rowCount: 1, rows: [] }; }
      if (S.includes("SET balance_q = balance_q - $2")) {
        account.balance_q = r2(account.balance_q - params[1]);
        if (S.includes("lifetime_spent_q")) account.lifetime_spent_q = r2(account.lifetime_spent_q + params[1]);
        if (S.includes("lifetime_earned_q")) account.lifetime_earned_q = Math.max(0, r2(account.lifetime_earned_q - params[1]));
        return { rowCount: 1, rows: [] };
      }
      if (S.includes("balance_q, lifetime_earned_q, lifetime_spent_q FROM cashback_accounts")) {
        if (!account.exists) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ balance_q: account.balance_q, lifetime_earned_q: account.lifetime_earned_q, lifetime_spent_q: account.lifetime_spent_q }] };
      }
      throw new Error("unexpected SQL: " + S.slice(0, 90));
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
  assert.equal(c.account.balance_q, 5);
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

test("spendCashback: same-operation replay is idempotent", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 200, earnQ: 10, requestId: "tx-1" });
  await spendCashback(c, { ...base, amountQ: 7, requestId: "sp-1" });
  const replay = await spendCashback(c, { ...base, amountQ: 7, requestId: "sp-1" });
  assert.equal(replay.replay, true);
  assert.equal(c.account.balance_q, 3);
});

test("spendCashback: a requestId reused from a different tx type is rejected, not silently skipped", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 200, earnQ: 10, requestId: "shared" });
  // Reusing the EARN's request_id as a SPEND must NOT short-circuit as a no-op debit.
  await assert.rejects(() => spendCashback(c, { ...base, amountQ: 5, requestId: "shared" }), /ya se usó/i);
  assert.equal(c.account.balance_q, 10); // untouched — no phantom discount
});

test("spendCashback: a requestId from another customer's spend is rejected", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 200, earnQ: 10, requestId: "tx-1" });
  await spendCashback(c, { ...base, amountQ: 4, requestId: "sp-9" });
  await assert.rejects(() => spendCashback(c, { businessId: "b1", customerId: "c2", amountQ: 4, requestId: "sp-9" }), /ya se usó/i);
});

test("spendCashback: rejects an amount above the balance", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 100, earnQ: 5, requestId: "tx-1" });
  await assert.rejects(() => spendCashback(c, { ...base, amountQ: 9, requestId: "sp-x" }), /insuficiente/i);
  assert.equal(c.account.balance_q, 5);
});

test("spendCashback: rejects a non-positive amount", async () => {
  const c = mockClient();
  await assert.rejects(() => spendCashback(c, { ...base, amountQ: 0, requestId: "sp-z" }), /mayor que cero/i);
});

test("reverseCashback: claws back the cashback a refunded purchase accrued", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 100, earnQ: 5, requestId: "tx-1", sourceTransactionId: "tx-1" });
  assert.equal(c.account.balance_q, 5);
  const out = await reverseCashback(c, { ...base, sourceTransactionId: "tx-1" });
  assert.equal(out.reversed_q, 5);
  assert.equal(out.shortfall_q, 0);
  assert.equal(c.account.balance_q, 0);
});

test("reverseCashback: is idempotent (a second refund of the same sale is a no-op)", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 100, earnQ: 5, requestId: "tx-1", sourceTransactionId: "tx-1" });
  await reverseCashback(c, { ...base, sourceTransactionId: "tx-1" });
  const replay = await reverseCashback(c, { ...base, sourceTransactionId: "tx-1" });
  assert.equal(replay.replay, true);
  assert.equal(c.account.balance_q, 0);
});

test("reverseCashback: reverses the full amount even if already spent (balance goes negative)", async () => {
  const c = mockClient();
  await accrueCashback(c, { ...base, amountQ: 100, earnQ: 5, requestId: "tx-1", sourceTransactionId: "tx-1" });
  await spendCashback(c, { ...base, amountQ: 4, requestId: "sp-1" }); // balance now 1
  const out = await reverseCashback(c, { ...base, sourceTransactionId: "tx-1" });
  assert.equal(out.reversed_q, 5);
  assert.equal(out.shortfall_q, 0);
  assert.equal(c.account.balance_q, -4); // member must re-earn before spending again
});

test("reverseCashback: returns null when the source accrued nothing", async () => {
  const c = mockClient();
  assert.equal(await reverseCashback(c, { ...base, sourceTransactionId: "never" }), null);
});

test("getCashbackBalance: zero when there is no account yet", async () => {
  const c = mockClient();
  assert.deepEqual(await getCashbackBalance(c, "c1"), { balance_q: 0, lifetime_earned_q: 0, lifetime_spent_q: 0 });
});
