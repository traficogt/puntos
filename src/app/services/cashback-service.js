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

// ----- Gift-card / prepaid wallet operations (same ledger as cashback) -----
// A GIFT_CARD business funds the wallet by staff LOADs (with an optional bonus)
// and member-to-member gifts, instead of by cashback accrual. Spending reuses
// spendCashback above. See wallet-model.js for the config helpers.

// Staff loads (tops up) a member's wallet by `amountQ`, plus `bonusQ` of promo
// credit. Idempotent on `requestId`. Returns
// { loaded_q, base_q, bonus_q, balance_after_q, replay? }.
export async function loadStoredValue(
  client,
  { businessId, customerId, staffUserId = null, amountQ, bonusQ = 0, requestId, meta = {} }
) {
  const base = round2(amountQ);
  const bonus = Math.max(0, round2(bonusQ));
  if (!(base > 0)) throw badRequest("El monto a recargar debe ser mayor que cero.");
  const total = round2(base + bonus);
  const reqId = requestId || crypto.randomUUID();
  const balance = await lockAccount(client, businessId, customerId);
  const balanceAfter = round2(balance + total);
  const ins = await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, $4, $5, 'LOAD', $6, $7, NULL, $8)
     ON CONFLICT (business_id, request_id) DO NOTHING
     RETURNING id`,
    [crypto.randomUUID(), businessId, customerId, staffUserId, reqId, total, balanceAfter, { ...meta, base_q: base, bonus_q: bonus }]
  );
  if (ins.rowCount !== 1) return { loaded_q: 0, base_q: 0, bonus_q: 0, balance_after_q: balance, replay: true };
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q + $2, lifetime_earned_q = lifetime_earned_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [customerId, total]
  );
  return { loaded_q: total, base_q: base, bonus_q: bonus, balance_after_q: balanceAfter };
}

// A member gifts `amountQ` of their wallet to another member of the same
// business. Atomic: debits the sender and credits the recipient in one tx.
// Locks both accounts in a stable order to avoid deadlock, and re-checks
// idempotency under the locks so concurrent retries collapse. Returns
// { transferred_q, balance_after_q, replay? }.
export async function transferStoredValue(
  client,
  { businessId, fromCustomerId, toCustomerId, amountQ, requestId, meta = {} }
) {
  const amount = round2(amountQ);
  if (!(amount > 0)) throw badRequest("El monto a regalar debe ser mayor que cero.");
  if (fromCustomerId === toCustomerId) throw badRequest("No puedes regalar saldo a tu misma cuenta.");
  const reqId = requestId || crypto.randomUUID();
  // Lock both accounts first, in a deterministic order, so concurrent transfers
  // serialize and the idempotency check below sees any committed prior attempt.
  const order = [fromCustomerId, toCustomerId].sort();
  const bal = {};
  for (const cid of order) bal[cid] = await lockAccount(client, businessId, cid);
  const already = await client.query(
    `SELECT balance_after_q FROM cashback_transactions
      WHERE business_id = $1 AND request_id = $2 AND tx_type = 'TRANSFER_OUT'`,
    [businessId, reqId]
  );
  if (already.rows.length) {
    return { transferred_q: amount, balance_after_q: Number(already.rows[0].balance_after_q), replay: true };
  }
  const fromBalance = bal[fromCustomerId];
  if (amount - fromBalance > 0.000001) throw badRequest("Saldo insuficiente para regalar.");
  const fromAfter = round2(fromBalance - amount);
  const toAfter = round2(bal[toCustomerId] + amount);
  await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, NULL, $4, 'TRANSFER_OUT', $5, $6, NULL, $7)`,
    [crypto.randomUUID(), businessId, fromCustomerId, reqId, -amount, fromAfter, { ...meta, to_customer_id: toCustomerId }]
  );
  await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, NULL, $4, 'TRANSFER_IN', $5, $6, NULL, $7)`,
    [crypto.randomUUID(), businessId, toCustomerId, crypto.randomUUID(), amount, toAfter, { ...meta, from_customer_id: fromCustomerId }]
  );
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q - $2, lifetime_spent_q = lifetime_spent_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [fromCustomerId, amount]
  );
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q + $2, lifetime_earned_q = lifetime_earned_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [toCustomerId, amount]
  );
  return { transferred_q: amount, balance_after_q: fromAfter };
}
