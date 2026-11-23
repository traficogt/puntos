// Cashback ledger service — accrue, spend and read a member's store-credit
// balance. All mutations run inside a caller-supplied transaction `client` and
// are idempotent on (business_id, request_id) via uq_cashback_tx_request, so a
// retried order/award/spend never double-counts. The account row is locked FOR
// UPDATE before any balance change, so concurrent purchases serialize.
//
// Money is NUMERIC(12,2) Q in the database, matching the gift-card ledger. In
// here every amount is an integer of centavos (see utils/money.js): the NUMERIC
// strings pg returns are parsed exactly, balances are compared exactly, and SQL
// parameters go out as fixed two-decimal strings. The *_q fields returned to
// callers stay two-decimal numbers. See the migration
// 2026-11-20-cashback-ledger.sql and the pure helper cashback-model.js.

import crypto from "node:crypto";
import { badRequest, conflict } from "../../utils/http-error.js";
import {
  add,
  compare,
  fromMinor,
  isPositive,
  neg,
  sub,
  toMinor,
  toNumber,
} from "../../utils/money.js";

// Locks the member's account row and returns its balance in centavos.
async function lockAccount(client, businessId, customerId) {
  await client.query(
    `INSERT INTO cashback_accounts (customer_id, business_id)
     VALUES ($1, $2) ON CONFLICT (customer_id) DO NOTHING`,
    [customerId, businessId],
  );
  const row = await client.query(
    `SELECT balance_q FROM cashback_accounts WHERE customer_id = $1 FOR UPDATE`,
    [customerId],
  );
  if (!row.rows.length) throw badRequest("No se pudo abrir la cuenta de cashback.");
  return toMinor(row.rows[0].balance_q);
}

// Credit a purchase's cashback. Returns null when there is nothing to earn, or
// { earn_q, balance_after_q, replay? } otherwise. `requestId` should be the
// source transaction id so a replayed award does not credit twice.
export async function accrueCashback(
  client,
  {
    businessId,
    customerId,
    staffUserId = null,
    amountQ = 0,
    earnQ,
    sourceTransactionId = null,
    requestId,
    meta = {},
  },
) {
  const earn = toMinor(earnQ);
  if (!isPositive(earn)) return null;
  const reqId = requestId || crypto.randomUUID();
  const balance = await lockAccount(client, businessId, customerId);
  const balanceAfter = add(balance, earn);
  const ins = await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, $4, $5, 'EARN', $6, $7, $8, $9)
     ON CONFLICT (business_id, request_id) DO NOTHING
     RETURNING id`,
    [
      crypto.randomUUID(),
      businessId,
      customerId,
      staffUserId,
      reqId,
      fromMinor(earn),
      fromMinor(balanceAfter),
      sourceTransactionId,
      { ...meta, amount_q: toNumber(toMinor(amountQ)) },
    ],
  );
  if (ins.rowCount !== 1) return { earn_q: 0, balance_after_q: toNumber(balance), replay: true };
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q + $2, lifetime_earned_q = lifetime_earned_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [customerId, fromMinor(earn)],
  );
  return { earn_q: toNumber(earn), balance_after_q: toNumber(balanceAfter) };
}

// Spend (apply) cashback credit as a discount. Debits up to the balance; throws
// on insufficient funds. Idempotent on `requestId`. Returns { spent_q,
// balance_after_q, replay? }.
export async function spendCashback(
  client,
  { businessId, customerId, staffUserId = null, amountQ, requestId, meta = {} },
) {
  const spend = toMinor(amountQ);
  if (!isPositive(spend)) throw badRequest("El monto a usar debe ser mayor que cero.");
  const reqId = requestId || crypto.randomUUID();
  const already = await client.query(
    `SELECT tx_type, customer_id, balance_after_q FROM cashback_transactions WHERE business_id = $1 AND request_id = $2`,
    [businessId, reqId],
  );
  if (already.rows.length) {
    const row = already.rows[0];
    if (row.tx_type !== "SPEND" || row.customer_id !== customerId) {
      throw conflict("El identificador de la operación ya se usó para otra transacción.");
    }
    return {
      spent_q: toNumber(spend),
      balance_after_q: toNumber(toMinor(row.balance_after_q)),
      replay: true,
    };
  }
  const balance = await lockAccount(client, businessId, customerId);
  if (compare(spend, balance) > 0) throw badRequest("Saldo de cashback insuficiente.");
  const balanceAfter = sub(balance, spend);
  const ins = await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, $4, $5, 'SPEND', $6, $7, NULL, $8)
     ON CONFLICT (business_id, request_id) DO NOTHING
     RETURNING id`,
    [
      crypto.randomUUID(),
      businessId,
      customerId,
      staffUserId,
      reqId,
      fromMinor(neg(spend)),
      fromMinor(balanceAfter),
      meta,
    ],
  );
  if (ins.rowCount !== 1) {
    const prev = await client.query(
      `SELECT tx_type, customer_id, balance_after_q FROM cashback_transactions WHERE business_id = $1 AND request_id = $2`,
      [businessId, reqId],
    );
    const row = prev.rows[0];
    if (!row || row.tx_type !== "SPEND" || row.customer_id !== customerId) {
      throw conflict("El identificador de la operación ya se usó para otra transacción.");
    }
    return {
      spent_q: toNumber(spend),
      balance_after_q: toNumber(toMinor(row.balance_after_q)),
      replay: true,
    };
  }
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q - $2, lifetime_spent_q = lifetime_spent_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [customerId, fromMinor(spend)],
  );
  return { spent_q: toNumber(spend), balance_after_q: toNumber(balanceAfter) };
}

// Reverse the cashback a specific source transaction accrued, when that purchase
// is refunded or returned. Idempotent per source transaction (a second refund of
// the same sale is a no-op). Reverses the full accrued amount even when the
// member already spent it, so the balance can go negative; `shortfall_q` is kept
// at 0 in the result for callers that still read it. Returns null when the
// source accrued no cashback (non-cashback business, a pending award, or nothing
// earned).
export async function reverseCashback(
  client,
  { businessId, customerId, sourceTransactionId, meta = {} },
) {
  const earnedRow = await client.query(
    `SELECT COALESCE(SUM(amount_q), 0) AS earned_q
       FROM cashback_transactions
      WHERE business_id = $1 AND source_transaction_id = $2 AND tx_type = 'EARN'`,
    [businessId, sourceTransactionId],
  );
  const accrued = toMinor(earnedRow.rows[0]?.earned_q ?? 0);
  if (!isPositive(accrued)) return null;
  const dup = await client.query(
    `SELECT balance_after_q FROM cashback_transactions
      WHERE business_id = $1 AND source_transaction_id = $2 AND tx_type = 'REVERSE'`,
    [businessId, sourceTransactionId],
  );
  if (dup.rows.length) {
    return {
      reversed_q: 0,
      balance_after_q: toNumber(toMinor(dup.rows[0].balance_after_q)),
      replay: true,
    };
  }
  const balance = await lockAccount(client, businessId, customerId);
  // Full clawback: reverse everything the sale accrued, even if it drives the
  // balance negative (the member must re-earn before spending again). The
  // cashback_accounts non-negative CHECK was removed for this — see migration
  // 2026-11-22-cashback-allow-negative.sql. Only CASHBACK-program refunds reach
  // here, so gift-card wallets (same table, never reversed) stay >= 0.
  const amount = accrued;
  const shortfall = 0;
  const reqId = `reverse:${sourceTransactionId}`;
  const balanceAfter = sub(balance, amount);
  const ins = await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, $4, $5, 'REVERSE', $6, $7, $8, $9)
     ON CONFLICT (business_id, request_id) DO NOTHING
     RETURNING id`,
    [
      crypto.randomUUID(),
      businessId,
      customerId,
      null,
      reqId,
      fromMinor(neg(amount)),
      fromMinor(balanceAfter),
      sourceTransactionId,
      { ...meta, accrued_q: toNumber(accrued), shortfall_q: shortfall },
    ],
  );
  if (ins.rowCount !== 1) {
    return {
      reversed_q: 0,
      balance_after_q: toNumber(balance),
      shortfall_q: shortfall,
      replay: true,
    };
  }
  if (isPositive(amount)) {
    await client.query(
      `UPDATE cashback_accounts
          SET balance_q = balance_q - $2,
              lifetime_earned_q = GREATEST(0, lifetime_earned_q - $2),
              updated_at = now()
        WHERE customer_id = $1`,
      [customerId, fromMinor(amount)],
    );
  }
  return {
    reversed_q: toNumber(amount),
    balance_after_q: toNumber(balanceAfter),
    shortfall_q: shortfall,
  };
}

// Read a member's cashback balance. Returns zeros when there is no account row
// yet (nothing earned). Uses any client/pool handle.
export async function getCashbackBalance(client, customerId) {
  const row = await client.query(
    `SELECT balance_q, lifetime_earned_q, lifetime_spent_q FROM cashback_accounts WHERE customer_id = $1`,
    [customerId],
  );
  if (!row.rows.length) return { balance_q: 0, lifetime_earned_q: 0, lifetime_spent_q: 0 };
  return {
    balance_q: toNumber(toMinor(row.rows[0].balance_q)),
    lifetime_earned_q: toNumber(toMinor(row.rows[0].lifetime_earned_q)),
    lifetime_spent_q: toNumber(toMinor(row.rows[0].lifetime_spent_q)),
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
  { businessId, customerId, staffUserId = null, amountQ, bonusQ = 0, requestId, meta = {} },
) {
  const base = toMinor(amountQ);
  const bonus = Math.max(0, toMinor(bonusQ));
  if (!isPositive(base)) throw badRequest("El monto a recargar debe ser mayor que cero.");
  const total = add(base, bonus);
  const reqId = requestId || crypto.randomUUID();
  const balance = await lockAccount(client, businessId, customerId);
  const balanceAfter = add(balance, total);
  const ins = await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, $4, $5, 'LOAD', $6, $7, NULL, $8)
     ON CONFLICT (business_id, request_id) DO NOTHING
     RETURNING id`,
    [
      crypto.randomUUID(),
      businessId,
      customerId,
      staffUserId,
      reqId,
      fromMinor(total),
      fromMinor(balanceAfter),
      { ...meta, base_q: toNumber(base), bonus_q: toNumber(bonus) },
    ],
  );
  if (ins.rowCount !== 1)
    return { loaded_q: 0, base_q: 0, bonus_q: 0, balance_after_q: toNumber(balance), replay: true };
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q + $2, lifetime_earned_q = lifetime_earned_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [customerId, fromMinor(total)],
  );
  return {
    loaded_q: toNumber(total),
    base_q: toNumber(base),
    bonus_q: toNumber(bonus),
    balance_after_q: toNumber(balanceAfter),
  };
}

// A member gifts `amountQ` of their wallet to another member of the same
// business. Atomic: debits the sender and credits the recipient in one tx.
// Locks both accounts in a stable order to avoid deadlock, and re-checks
// idempotency under the locks so concurrent retries collapse. Returns
// { transferred_q, balance_after_q, replay? }.
export async function transferStoredValue(
  client,
  { businessId, fromCustomerId, toCustomerId, amountQ, requestId, meta = {} },
) {
  const amount = toMinor(amountQ);
  if (!isPositive(amount)) throw badRequest("El monto a regalar debe ser mayor que cero.");
  if (fromCustomerId === toCustomerId)
    throw badRequest("No puedes regalar saldo a tu misma cuenta.");
  const reqId = requestId || crypto.randomUUID();
  // Lock both accounts first, in a deterministic order, so concurrent transfers
  // serialize and the idempotency check below sees any committed prior attempt.
  const order = [fromCustomerId, toCustomerId].sort();
  const bal = {};
  for (const cid of order) bal[cid] = await lockAccount(client, businessId, cid);
  const already = await client.query(
    `SELECT balance_after_q FROM cashback_transactions
      WHERE business_id = $1 AND request_id = $2 AND tx_type = 'TRANSFER_OUT'`,
    [businessId, reqId],
  );
  if (already.rows.length) {
    return {
      transferred_q: toNumber(amount),
      balance_after_q: toNumber(toMinor(already.rows[0].balance_after_q)),
      replay: true,
    };
  }
  const fromBalance = bal[fromCustomerId];
  if (compare(amount, fromBalance) > 0) throw badRequest("Saldo insuficiente para regalar.");
  const fromAfter = sub(fromBalance, amount);
  const toAfter = add(bal[toCustomerId], amount);
  await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, NULL, $4, 'TRANSFER_OUT', $5, $6, NULL, $7)`,
    [
      crypto.randomUUID(),
      businessId,
      fromCustomerId,
      reqId,
      fromMinor(neg(amount)),
      fromMinor(fromAfter),
      { ...meta, to_customer_id: toCustomerId },
    ],
  );
  await client.query(
    `INSERT INTO cashback_transactions
       (id, business_id, customer_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, source_transaction_id, meta)
     VALUES ($1, $2, $3, NULL, $4, 'TRANSFER_IN', $5, $6, NULL, $7)`,
    [
      crypto.randomUUID(),
      businessId,
      toCustomerId,
      crypto.randomUUID(),
      fromMinor(amount),
      fromMinor(toAfter),
      { ...meta, from_customer_id: fromCustomerId },
    ],
  );
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q - $2, lifetime_spent_q = lifetime_spent_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [fromCustomerId, fromMinor(amount)],
  );
  await client.query(
    `UPDATE cashback_accounts
       SET balance_q = balance_q + $2, lifetime_earned_q = lifetime_earned_q + $2, updated_at = now()
     WHERE customer_id = $1`,
    [toCustomerId, fromMinor(amount)],
  );
  return { transferred_q: toNumber(amount), balance_after_q: toNumber(fromAfter) };
}
