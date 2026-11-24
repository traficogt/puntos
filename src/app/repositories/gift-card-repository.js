import { one, many, exec } from "./base.js";

/**
 * Row of `gift_cards`. Money columns are NUMERIC and arrive as strings.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id: string | null,
 *   code: string,
 *   qr_token: string,
 *   issued_to_name: string | null,
 *   issued_to_phone: string | null,
 *   initial_amount_q: string,
 *   balance_q: string,
 *   status: string,
 *   expires_at: Date | null,
 *   created_by: string | null,
 *   created_at: Date,
 *   updated_at: Date
 * }} GiftCardRow
 */

/**
 * Row of `gift_card_transactions`.
 * @typedef {{
 *   id: string,
 *   gift_card_id: string,
 *   business_id: string,
 *   staff_user_id: string | null,
 *   request_id: string | null,
 *   tx_type: string,
 *   amount_q: string,
 *   balance_after_q: string,
 *   meta: Record<string, unknown>,
 *   created_at: Date
 * }} GiftCardTransactionRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id?: string | null,
 *   code: string,
 *   qr_token: string,
 *   issued_to_name?: string | null,
 *   issued_to_phone?: string | null,
 *   initial_amount_q: number | string,
 *   balance_q: number | string,
 *   status?: string | null,
 *   expires_at?: Date | string | null,
 *   created_by?: string | null
 * }} GiftCardCreateInput
 */

/**
 * @typedef {{
 *   id: string,
 *   gift_card_id: string,
 *   business_id: string,
 *   staff_user_id?: string | null,
 *   request_id?: string | null,
 *   tx_type: string,
 *   amount_q: number | string,
 *   balance_after_q: number | string,
 *   meta?: Record<string, unknown> | null
 * }} GiftCardTransactionInput
 */

export const GiftCardRepo = {
  /**
   * Resolves to `GiftCardRow | null`.
   * @param {GiftCardCreateInput} card
   */
  async create(card) {
    await exec(
      `INSERT INTO gift_cards (
         id, business_id, branch_id, code, qr_token, issued_to_name, issued_to_phone,
         initial_amount_q, balance_q, status, expires_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        card.id,
        card.business_id,
        card.branch_id ?? null,
        card.code,
        card.qr_token,
        card.issued_to_name ?? null,
        card.issued_to_phone ?? null,
        card.initial_amount_q,
        card.balance_q,
        card.status ?? "ACTIVE",
        card.expires_at ?? null,
        card.created_by ?? null,
      ],
    );
    return this.getById(card.id);
  },

  /**
   * Resolves to `GiftCardRow | null`.
   * @param {string} id
   */
  async getById(id) {
    return one(`SELECT * FROM gift_cards WHERE id = $1`, [id]);
  },

  /**
   * Resolves to `GiftCardRow | null`.
   * @param {string} businessId
   * @param {string} codeOrToken
   */
  async getByCodeOrToken(businessId, codeOrToken) {
    return one(`SELECT * FROM gift_cards WHERE business_id = $1 AND (code = $2 OR qr_token = $2)`, [
      businessId,
      codeOrToken,
    ]);
  },

  /**
   * Resolves to `GiftCardRow[]`.
   * @param {string} businessId
   * @param {number} [limit]
   */
  async listByBusiness(businessId, limit = 100) {
    return many(
      `SELECT * FROM gift_cards WHERE business_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [businessId, limit],
    );
  },

  /**
   * Resolves to `GiftCardRow | null`.
   * @param {string} id
   * @param {number | string} balance
   * @param {string} status
   */
  async updateBalanceAndStatus(id, balance, status) {
    await exec(
      `UPDATE gift_cards SET balance_q = $2, status = $3, updated_at = now() WHERE id = $1`,
      [id, balance, status],
    );
    return this.getById(id);
  },

  /** @param {GiftCardTransactionInput} tx */
  async addTx(tx) {
    await exec(
      `INSERT INTO gift_card_transactions (id, gift_card_id, business_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tx.id,
        tx.gift_card_id,
        tx.business_id,
        tx.staff_user_id ?? null,
        tx.request_id ?? null,
        tx.tx_type,
        tx.amount_q,
        tx.balance_after_q,
        tx.meta ?? {},
      ],
    );
  },

  /**
   * Resolves to `GiftCardTransactionRow[]`.
   * @param {string} giftCardId
   * @param {number} [limit]
   */
  async listTxByCard(giftCardId, limit = 50) {
    return many(
      `SELECT * FROM gift_card_transactions WHERE gift_card_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [giftCardId, limit],
    );
  },
};
