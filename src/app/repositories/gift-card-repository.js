import { one, many, exec } from "./base.js";

export const GiftCardRepo = {
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
        card.created_by ?? null
      ]
    );
    return this.getById(card.id);
  },

  async getById(id) {
    return one(`SELECT * FROM gift_cards WHERE id = $1`, [id]);
  },

  async getByCodeOrToken(businessId, codeOrToken) {
    return one(
      `SELECT * FROM gift_cards WHERE business_id = $1 AND (code = $2 OR qr_token = $2)`,
      [businessId, codeOrToken]
    );
  },

  async listByBusiness(businessId, limit = 100) {
    return many(
      `SELECT * FROM gift_cards WHERE business_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [businessId, limit]
    );
  },

  async updateBalanceAndStatus(id, balance, status) {
    await exec(
      `UPDATE gift_cards SET balance_q = $2, status = $3, updated_at = now() WHERE id = $1`,
      [id, balance, status]
    );
    return this.getById(id);
  },

  async addTx(tx) {
    await exec(
      `INSERT INTO gift_card_transactions (id, gift_card_id, business_id, staff_user_id, tx_type, amount_q, balance_after_q, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        tx.id,
        tx.gift_card_id,
        tx.business_id,
        tx.staff_user_id ?? null,
        tx.tx_type,
        tx.amount_q,
        tx.balance_after_q,
        tx.meta ?? {}
      ]
    );
  },

  async listTxByCard(giftCardId, limit = 50) {
    return many(
      `SELECT * FROM gift_card_transactions WHERE gift_card_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [giftCardId, limit]
    );
  }
};
