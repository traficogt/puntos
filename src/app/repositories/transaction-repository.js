import { one, many, exec } from "./base.js";
import { publicCustomerTransaction } from "../services/customer-history-provenance.js";

/**
 * Row of `transactions`. `amount_q` is NUMERIC and arrives as a string.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id: string | null,
 *   customer_id: string,
 *   staff_user_id: string | null,
 *   type: string | null,
 *   amount_q: string,
 *   points: number,
 *   status: string,
 *   available_at: Date | null,
 *   expired_at: Date | null,
 *   original_transaction_id: string | null,
 *   reversed_transaction_id: string | null,
 *   request_id: string | null,
 *   reversal_reason: string | null,
 *   source: string,
 *   meta: Record<string, unknown>,
 *   visits: number,
 *   items: number,
 *   purchase_occurred_at: Date | null,
 *   purchase_time_source: string | null,
 *   created_at: Date
 * }} TransactionRow
 */

/**
 * Customer-facing projection returned by {@link TxnRepo.listByCustomer}.
 * @typedef {Pick<TransactionRow,
 *   | "id" | "business_id" | "branch_id" | "customer_id" | "staff_user_id" | "amount_q"
 *   | "source" | "meta" | "created_at">
 *   & { points_delta: number, reward_name: string | null }} CustomerTransactionRow
 */

/**
 * Provenance-aware history projection fed to `publicCustomerTransaction`.
 * @typedef {Pick<TransactionRow,
 *   | "id" | "business_id" | "branch_id" | "customer_id" | "amount_q" | "source" | "type"
 *   | "status" | "reversed_transaction_id" | "visits" | "items" | "meta" | "created_at">
 *   & { points_delta: number, reward_name: string | null, has_original_transaction: boolean }} TransactionHistoryRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id?: string | null,
 *   customer_id: string,
 *   staff_user_id?: string | null,
 *   amount_q: number | string,
 *   points: number,
 *   source: string,
 *   meta?: Record<string, unknown> | null
 * }} TransactionCreateInput
 */

/**
 * @typedef {{ tx_count: number, amount_sum: string, points_sum: number }} TransactionSummary
 */

export const TxnRepo = {
  /**
   * Resolves to `TransactionRow | null`.
   * @param {TransactionCreateInput} transaction
   */
  async create({
    id,
    business_id,
    branch_id,
    customer_id,
    staff_user_id,
    amount_q,
    points,
    source,
    meta,
  }) {
    await exec(
      `INSERT INTO transactions (id, business_id, branch_id, customer_id, staff_user_id, amount_q, points, source, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        business_id,
        branch_id ?? null,
        customer_id,
        staff_user_id ?? null,
        amount_q,
        points,
        source,
        meta ?? {},
      ],
    );
    return this.getById(id);
  },

  /**
   * Resolves to `TransactionRow | null`.
   * @param {string} id
   */
  async getById(id) {
    return one(`SELECT * FROM transactions WHERE id=$1`, [id]);
  },

  /**
   * Resolves to `CustomerTransactionRow[]`.
   * @param {string} customerId
   * @param {number} [limit]
   */
  async listByCustomer(customerId, limit = 50) {
    return many(
      `SELECT
         t.id,
         t.business_id,
         t.branch_id,
         t.customer_id,
         t.staff_user_id,
         t.amount_q,
         t.points AS points_delta,
         t.source,
         t.meta,
         t.created_at,
         r.name AS reward_name
       FROM transactions t
       LEFT JOIN rewards r
         ON r.id = CASE
           WHEN (t.meta->>'reward_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           THEN (t.meta->>'reward_id')::uuid
           ELSE NULL
         END
       WHERE t.customer_id=$1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [customerId, limit],
    );
  },

  /**
   * @param {string} businessId
   * @param {string} customerId
   * @param {number} [limit]
   */
  async listCustomerHistory(businessId, customerId, limit = 50) {
    /** @type {TransactionHistoryRow[]} */
    const rows = await many(
      `SELECT t.id,t.business_id,t.branch_id,t.customer_id,
      t.amount_q,t.points AS points_delta,t.source,t.type,t.status,t.reversed_transaction_id,
      t.visits,t.items,t.meta,t.created_at,r.name AS reward_name,
      EXISTS(SELECT 1 FROM transactions original WHERE original.id=t.original_transaction_id
        AND original.business_id=t.business_id AND original.customer_id=t.customer_id) AS has_original_transaction
      FROM transactions t LEFT JOIN rewards r ON r.business_id=t.business_id AND r.id::text=t.meta->>'reward_id'
      WHERE t.business_id=$1 AND t.customer_id=$2
      ORDER BY t.created_at DESC,t.id DESC LIMIT $3`,
      [businessId, customerId, limit],
    );
    return rows.map(publicCustomerTransaction);
  },

  /**
   * Resolves to `TransactionSummary`.
   * @param {string} businessId
   * @param {number} [days]
   * @param {string | null} [branchId]
   */
  async summaryByBusiness(businessId, days = 30, branchId = null) {
    const params = [businessId, String(days)];
    let branchClause = "";
    if (branchId) {
      params.push(branchId);
      branchClause = " AND branch_id = $3";
    }
    // Basic reporting: movements of test accounts (customers.is_test) stay out of the
    // 30-day figures; the ledger and the customer history still list them.
    const r = await one(
      `SELECT
         COUNT(*)::int AS tx_count,
         COALESCE(SUM(amount_q),0)::numeric(10,2) AS amount_sum,
         COALESCE(SUM(points),0)::int AS points_sum
       FROM transactions
       WHERE business_id=$1 AND created_at >= now() - ($2 || ' days')::interval${branchClause}
         AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = transactions.customer_id AND c.is_test)`,
      params,
    );
    return r ?? { tx_count: 0, amount_sum: "0.00", points_sum: 0 };
  },
};
