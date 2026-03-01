import { dbQuery } from "../database.js";
import crypto from "node:crypto";

const REFERRAL_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const ReferralRepository = {
  generateReferralCode() {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += REFERRAL_CODE_CHARS[crypto.randomInt(0, REFERRAL_CODE_CHARS.length)];
    }
    return code;
  },

  async getOrCreateReferralCode(customerId, businessId) {
    let { rows } = await dbQuery(
      `SELECT * FROM referral_codes 
       WHERE referrer_customer_id = $1 AND business_id = $2`,
      [customerId, businessId]
    );

    if (rows[0]) {
      return rows[0];
    }

    let code;
    let attempts = 0;
    while (attempts < 10) {
      code = this.generateReferralCode();
      const { rows: existing } = await dbQuery(
        `SELECT id FROM referral_codes WHERE code = $1`,
        [code]
      );
      if (!existing[0]) break;
      attempts++;
    }

    if (!code) {
      throw new Error("Failed to generate unique referral code");
    }

    const { rows: created } = await dbQuery(
      `INSERT INTO referral_codes 
       (business_id, referrer_customer_id, code, active)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [businessId, customerId, code]
    );

    return created[0];
  },

  async getByCode(code) {
    const { rows } = await dbQuery(
      `SELECT * FROM referral_codes WHERE code = $1 AND active = true`,
      [code.toUpperCase()]
    );
    return rows[0];
  },

  async createReferral(referralCodeId, referrerCustomerId, referredCustomerId, businessId) {
    const { rows } = await dbQuery(
      `INSERT INTO referrals 
       (business_id, referral_code_id, referrer_customer_id, referred_customer_id, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [businessId, referralCodeId, referrerCustomerId, referredCustomerId]
    );

    await dbQuery(
      `UPDATE referral_codes 
       SET uses_count = uses_count + 1 
       WHERE id = $1`,
      [referralCodeId]
    );

    return rows[0];
  },

  async completeReferral(referralId, referrerRewardPoints, referredRewardPoints) {
    const { rows } = await dbQuery(
      `UPDATE referrals 
       SET 
         status = 'completed',
         completed_at = now(),
         referrer_reward_points = $2,
         referred_reward_points = $3
       WHERE id = $1
       RETURNING *`,
      [referralId, referrerRewardPoints, referredRewardPoints]
    );
    return rows[0];
  },

  async markRewarded(referralId, rewardType = "both") {
    const updates = { status: "rewarded" };
    
    if (rewardType === "referrer" || rewardType === "both") {
      updates.referrer_rewarded_at = "now()";
    }
    if (rewardType === "referred" || rewardType === "both") {
      updates.referred_rewarded_at = "now()";
    }

    const setClauses = Object.keys(updates)
      .map((key, i) => `${key} = ${updates[key] === "now()" ? "now()" : `$${i + 2}`}`)
      .join(", ");

    const values = [referralId, ...Object.values(updates).filter((value) => value !== "now()")];

    const { rows } = await dbQuery(
      `UPDATE referrals SET ${setClauses} WHERE id = $1 RETURNING *`,
      values
    );
    return rows[0];
  },

  async getReferralsByReferrer(referrerCustomerId) {
    const { rows } = await dbQuery(
      `SELECT 
         r.*,
         c.name as referred_customer_name,
         c.phone as referred_customer_phone
       FROM referrals r
       JOIN customers c ON c.id = r.referred_customer_id
       WHERE r.referrer_customer_id = $1
       ORDER BY r.created_at DESC`,
      [referrerCustomerId]
    );
    return rows;
  },

  async getReferralStats(customerId) {
    const { rows } = await dbQuery(
      `SELECT 
         COUNT(*) as total_referrals,
         COUNT(*) FILTER (WHERE status = 'completed') as completed_referrals,
         COUNT(*) FILTER (WHERE status = 'rewarded') as rewarded_referrals,
         COALESCE(SUM(referrer_reward_points), 0) as total_points_earned
       FROM referrals
       WHERE referrer_customer_id = $1`,
      [customerId]
    );
    return rows[0];
  },

  async getPendingReferrals(businessId) {
    const { rows } = await dbQuery(
      `SELECT r.*
       FROM referrals r
       WHERE r.business_id = $1
         AND r.status = 'pending'`,
      [businessId]
    );
    return rows;
  },

  async getReferralForCustomer(customerId) {
    const { rows } = await dbQuery(
      `SELECT * FROM referrals WHERE referred_customer_id = $1`,
      [customerId]
    );
    return rows[0];
  },

  async getSettings(businessId) {
    const { rows } = await dbQuery(
      `SELECT * FROM referral_settings WHERE business_id = $1`,
      [businessId]
    );
    return rows[0];
  },

  async updateSettings(businessId, settings) {
    const { rows } = await dbQuery(
      `INSERT INTO referral_settings 
       (business_id, enabled, referrer_reward_points, referred_reward_points, 
        min_purchase_to_complete, reward_on_signup, custom_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (business_id)
       DO UPDATE SET
         enabled = $2,
         referrer_reward_points = $3,
         referred_reward_points = $4,
         min_purchase_to_complete = $5,
         reward_on_signup = $6,
         custom_message = $7,
         updated_at = now()
       RETURNING *`,
      [
        businessId,
        settings.enabled,
        settings.referrer_reward_points,
        settings.referred_reward_points,
        settings.min_purchase_to_complete || null,
        settings.reward_on_signup || false,
        settings.custom_message || null
      ]
    );
    return rows[0];
  },

  async getLeaderboard(businessId, limit = 10) {
    const { rows } = await dbQuery(
      `SELECT 
         c.id,
         c.name,
         COUNT(r.id) as referral_count,
         COALESCE(SUM(r.referrer_reward_points), 0) as total_points
       FROM customers c
       JOIN referrals r ON r.referrer_customer_id = c.id
       WHERE c.business_id = $1 AND r.status = 'rewarded'
       GROUP BY c.id, c.name
       ORDER BY referral_count DESC, total_points DESC
       LIMIT $2`,
      [businessId, limit]
    );
    return rows;
  }
};
