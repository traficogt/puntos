// Cashback ledger service — accrue, spend and read a member's store-credit
// balance. All mutations run inside a caller-supplied transaction `client` and
// are idempotent on (business_id, request_id) via uq_cashback_tx_request, so a
// retried order/award/spend never double-counts. The account row is locked FOR
// UPDATE before any balance change, so concurrent purchases serialize.
//
// Money is NUMERIC(12,2) Q, matching the gift-card ledger. See the migration
// 2026-11-20-cashback-ledger.sql and the pure helper cashback-model.js.

import crypto from "node:crypto";
import { badRequest } from "../../utils/http-error.js";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function lockAccount(client, businessId, customerId) {
  await client.query(
    `INSERT INTO cashback_accounts (customer_id, business_id)
     VALUES ($1, $2) ON CONFLICT (customer_id) DO NOTHING`,
    [customerId, businessId]
  );
  const row = await client.query(
    `SELECT balance_q FROM cashback_accounts WHERE customer_id = $1 FOR UPDATE`,
    [customerId]
  );
  if (!row.rows.length) throw badRequest("No se pudo abrir la cuenta de cashback.");
  return Number(row.rows[0].balance_q);
}

// Credit a purchase's cashback. Returns null when there is nothing to earn, or
// { earn_q, balance_after_q, replay? } otherwise. `requestId` should be the
// source transaction id so a replayed award does not credit twice.
export async function accrueCashback(
  client,
  { businessId, customerId, staffUserId = null, amountQ = 0, earnQ, sourceTransactionId = null, requestId, meta = {} }
) {
  const earn = round2(earnQ);
  if (!(earn > 0)) return null;
  const reqId = requestId || crypto.randomUUID();
  const balance = await lockAccount(client, businessId, customerId);
  const balanceAfter = round2(balance + earn);
  const ins = await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, $4, $5, 'EARN', $6, $7, $8, $9)
     ON CONFLICT (business_id, request_id) DO NOTHING
     RETURNING id`,
    [crypto.randomUUID(), businessId, customerId, staffUserId, reqId, earn, balanceAfter, sourceTransactionId, { ...meta, amount_q: round2(amountQ) }]
  );
  if (ins.rowCount !== 1) return { earn_q: 0, balance_after_q: balance, replay: true };
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q + $2, lifetime_earned_q = lifetime_earned_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [customerId, earn]
  );
  return { earn_q: earn, balance_after_q: balanceAfter };
}

// Spend (apply) cashback credit as a discount. Debits up to the balance; throws
// on insufficient funds. Idempotent on `requestId`. Returns { spent_q,
// balance_after_q, replay? }.
export async function spendCashback(
  client,
  { businessId, customerId, staffUserId = null, amountQ, requestId, meta = {} }
) {
  const spend = round2(amountQ);
  if (!(spend > 0)) throw badRequest("El monto a usar debe ser mayor que cero.");
  const reqId = requestId || crypto.randomUUID();
  const already = await client.query(
    `SELECT balance_after_q FROM cashback_transactions WHERE business_id = $1 AND request_id = $2`,
    [businessId, reqId]
  );
  if (already.rows.length) {
    return { spent_q: spend, balance_after_q: Number(already.rows[0].balance_after_q), replay: true };
  }
  const balance = await lockAccount(client, businessId, customerId);
  if (spend - balance > 0.000001) throw badRequest("Saldo de cashback insuficiente.");
  const balanceAfter = round2(balance - spend);
  const ins = await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, $4, $5, 'SPEND', $6, $7, NULL, $8)
     ON CONFLICT (business_id, request_id) DO NOTHING
     RETURNING id`,
    [crypto.randomUUID(), businessId, customerId, staffUserId, reqId, -spend, balanceAfter, meta]
  );
  if (ins.rowCount !== 1) {
    const prev = await client.query(
      `SELECT balance_after_q FROM cashback_transactions WHERE business_id = $1 AND request_id = $2`,
      [businessId, reqId]
    );
    return { spent_q: spend, balance_after_q: Number(prev.rows[0]?.balance_after_q ?? balance), replay: true };
  }
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q - $2, lifetime_spent_q = lifetime_spent_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [customerId, spend]
  );
  return { spent_q: spend, balance_after_q: balanceAfter };
}

// Read a member's cashback balance. Returns zeros when there is no account row
// yet (nothing earned). Uses any client/pool handle.
export async function getCashbackBalance(client, customerId) {
  const row = await client.query(
    `SELECT balance_q, lifetime_earned_q, lifetime_spent_q FROM cashback_accounts WHERE customer_id = $1`,
    [customerId]
  );
  if (!row.rows.length) return { balance_q: 0, lifetime_earned_q: 0, lifetime_spent_q: 0 };
  return {
    balance_q: Number(row.rows[0].balance_q),
    lifetime_earned_q: Number(row.rows[0].lifetime_earned_q),
    lifetime_spent_q: Number(row.rows[0].lifetime_spent_q)
  };
}
