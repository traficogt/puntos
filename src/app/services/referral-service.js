import { ReferralRepository } from "../repositories/referral-repository.js";
import { dbQuery, withTransaction } from "../database.js";
import { notFound, badRequest, forbidden } from "../../utils/http-error.js";
import { errorCode } from "../../utils/error-shape.js";

/**
 * Transaction client (src/types/db.ts); unit tests pass `{ query }` doubles.
 * @typedef {import("../../types/db.js").DbQueryClient} ReferralQueryClient
 * @typedef {{
 *   withTransaction: <T>(fn: (client: ReferralQueryClient) => Promise<T>) => Promise<T>
 * }} ReferralDeps
 * referral_codes row (ReferralRepository, repositories owner).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   referrer_customer_id: string,
 *   code: string,
 *   expires_at?: Date | string | null,
 *   max_uses?: number | null,
 *   uses_count: number,
 *   active: boolean
 * }} ReferralCodeRow
 * referrals row (ReferralRepository, repositories owner).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   referral_code_id: string,
 *   referrer_customer_id: string,
 *   referred_customer_id: string,
 *   status: string
 * }} ReferralRow
 * Owner-editable referral settings (ReferralRepository, repositories owner).
 * @typedef {import("../repositories/referral-repository.js").ReferralSettingsInput} ReferralSettingsInput
 */

/** @type {ReferralSettingsInput} */
const DEFAULT_SETTINGS = {
  enabled: false,
  referrer_reward_points: 100,
  referred_reward_points: 50,
  min_purchase_to_complete: null,
  reward_on_signup: false,
};

/** @param {string} customerId */
async function getCustomerBusinessId(customerId) {
  const { rows } = await dbQuery(`SELECT business_id FROM customers WHERE id = $1`, [customerId]);
  const customer = rows[0];

  if (!customer) {
    throw notFound("Cliente no encontrado");
  }

  return customer.business_id;
}

/** @param {string} businessId */
async function getEnabledSettings(businessId) {
  const settings = await ReferralRepository.getSettings(businessId);

  if (!settings?.enabled) {
    throw forbidden("El programa de referidos no está activo");
  }

  return settings;
}

/**
 * @param {ReferralCodeRow | undefined} code
 * @param {string} newCustomerId
 * @param {string} businessId
 */
function assertReferralCodeUsable(code, newCustomerId, businessId) {
  if (!code) {
    throw notFound("Código de referido no válido", "VALIDATION_ERROR");
  }

  if (code.business_id !== businessId) {
    throw badRequest("El código de referido pertenece a otro negocio");
  }

  if (code.expires_at && new Date(code.expires_at) < new Date()) {
    throw badRequest("El código de referido ya venció");
  }

  if (code.max_uses && code.uses_count >= code.max_uses) {
    throw badRequest("El código de referido alcanzó su máximo de usos");
  }

  if (code.referrer_customer_id === newCustomerId) {
    throw badRequest("No puedes usar tu propio código de referido");
  }
}

/** @param {string} customerId */
async function getPurchaseTotal(customerId) {
  const { rows } = await dbQuery(
    `SELECT COALESCE(SUM(amount_q), 0) AS total_spend
     FROM transactions
     WHERE customer_id = $1 AND amount_q IS NOT NULL`,
    [customerId],
  );

  return Number.parseFloat(rows[0]?.total_spend ?? 0);
}

/** @param {string} businessId */
async function getSettingsWithDefaults(businessId) {
  const settings = await ReferralRepository.getSettings(businessId);
  if (settings) {
    return settings;
  }

  return ReferralRepository.updateSettings(businessId, DEFAULT_SETTINGS);
}

/**
 * @param {ReferralQueryClient} client
 * @param {ReferralRow} referral
 * @param {string} customerId
 * @param {number} points
 * @param {"referrer" | "referred"} type
 */
async function logReferralReward(client, referral, customerId, points, type) {
  await client.query(
    `INSERT INTO transactions
     (business_id, customer_id, type, points, meta)
     VALUES ($1, $2, 'REFERRAL_REWARD', $3, $4)`,
    [referral.business_id, customerId, points, JSON.stringify({ referral_id: referral.id, type })],
  );
}

/**
 * @param {ReferralDeps} deps
 * @param {string} referralId
 */
export async function completeAndRewardReferralWithDeps(deps, referralId) {
  return deps.withTransaction(async (client) => {
    const { rows: referralRows } = await client.query(
      `SELECT * FROM referrals WHERE id = $1 FOR UPDATE`,
      [referralId],
    );
    const referral = referralRows[0];

    if (!referral) {
      throw notFound("Referido no encontrado");
    }

    if (referral.status !== "pending") {
      return referral;
    }

    const { rows: settingsRows } = await client.query(
      `SELECT * FROM referral_settings WHERE business_id = $1`,
      [referral.business_id],
    );
    const settings = settingsRows[0];

    if (!settings) {
      throw new Error("Referral settings not found");
    }

    const { rows: completedRows } = await client.query(
      `UPDATE referrals
       SET status = 'completed',
           completed_at = now(),
           referrer_reward_points = $2,
           referred_reward_points = $3
       WHERE id = $1
         AND status = 'pending'
       RETURNING *`,
      [referralId, settings.referrer_reward_points, settings.referred_reward_points],
    );
    const completedReferral = completedRows[0];

    if (!completedReferral) {
      const { rows: latestRows } = await client.query(`SELECT * FROM referrals WHERE id = $1`, [
        referralId,
      ]);
      return latestRows[0] ?? referral;
    }

    await client.query(
      `UPDATE customer_balances
       SET points = points + $1,
           lifetime_points = lifetime_points + GREATEST($1, 0),
           updated_at = now()
       WHERE customer_id = $2`,
      [settings.referrer_reward_points, referral.referrer_customer_id],
    );
    await client.query(
      `UPDATE customer_balances
       SET points = points + $1,
           lifetime_points = lifetime_points + GREATEST($1, 0),
           updated_at = now()
       WHERE customer_id = $2`,
      [settings.referred_reward_points, referral.referred_customer_id],
    );

    await logReferralReward(
      client,
      referral,
      referral.referrer_customer_id,
      settings.referrer_reward_points,
      "referrer",
    );
    await logReferralReward(
      client,
      referral,
      referral.referred_customer_id,
      settings.referred_reward_points,
      "referred",
    );

    await client.query(
      `UPDATE referrals
       SET status = 'rewarded',
           referrer_rewarded_at = now(),
           referred_rewarded_at = now()
       WHERE id = $1
       RETURNING *`,
      [referralId],
    );
    const { rows: rewardedRows } = await client.query(`SELECT * FROM referrals WHERE id = $1`, [
      referralId,
    ]);
    return rewardedRows[0] ?? completedReferral;
  });
}

/** @param {string} referralId */
async function completeAndRewardReferral(referralId) {
  return completeAndRewardReferralWithDeps({ withTransaction }, referralId);
}

/** @param {string} customerId */
async function getCustomerReferralCode(customerId) {
  const businessId = await getCustomerBusinessId(customerId);
  await getEnabledSettings(businessId);
  return ReferralRepository.getOrCreateReferralCode(customerId, businessId);
}

/**
 * @param {ReferralDeps} deps
 * @param {unknown} referralCode code as typed by the customer (upper-cased here)
 * @param {string} newCustomerId
 * @param {string} businessId
 */
export async function applyReferralCodeWithDeps(deps, referralCode, newCustomerId, businessId) {
  const { referral, settings } = await deps.withTransaction(async (client) => {
    const { rows: codeRows } = await client.query(
      `SELECT *
       FROM referral_codes
       WHERE code = $1
         AND active = true
       FOR UPDATE`,
      [String(referralCode || "").toUpperCase()],
    );
    const code = codeRows[0];
    assertReferralCodeUsable(code, newCustomerId, businessId);

    const existing = await client.query(
      `SELECT id
       FROM referrals
       WHERE referred_customer_id = $1
       LIMIT 1`,
      [newCustomerId],
    );
    if (Number(existing.rowCount) > 0) {
      throw badRequest("Este cliente ya fue referido");
    }

    const codeUpdate = await client.query(
      `UPDATE referral_codes
       SET uses_count = uses_count + 1
       WHERE id = $1
         AND (max_uses IS NULL OR uses_count < max_uses)
       RETURNING *`,
      [code.id],
    );
    if (codeUpdate.rowCount !== 1) {
      throw badRequest("El código de referido alcanzó su máximo de usos");
    }

    let createdReferral;
    try {
      const { rows } = await client.query(
        `INSERT INTO referrals
         (business_id, referral_code_id, referrer_customer_id, referred_customer_id, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [businessId, code.id, code.referrer_customer_id, newCustomerId],
      );
      createdReferral = rows[0];
    } catch (error) {
      if (String(errorCode(error)) === "23505") {
        throw badRequest("Este cliente ya fue referido");
      }
      throw error;
    }

    const { rows: settingsRows } = await client.query(
      `SELECT * FROM referral_settings WHERE business_id = $1`,
      [businessId],
    );

    return {
      referral: createdReferral,
      settings: settingsRows[0] ?? null,
    };
  });

  if (settings?.reward_on_signup) {
    await completeAndRewardReferral(referral.id);
  }

  return referral;
}

/**
 * @param {unknown} referralCode
 * @param {string} newCustomerId
 * @param {string} businessId
 */
async function applyReferralCode(referralCode, newCustomerId, businessId) {
  return applyReferralCodeWithDeps({ withTransaction }, referralCode, newCustomerId, businessId);
}

/** @param {string} customerId */
async function checkAndCompleteReferral(customerId) {
  const referral = await ReferralRepository.getReferralForCustomer(customerId);
  if (!referral || referral.status !== "pending") {
    return null;
  }

  const settings = await ReferralRepository.getSettings(referral.business_id);
  if (!settings?.min_purchase_to_complete) {
    return completeAndRewardReferral(referral.id);
  }

  const totalSpend = await getPurchaseTotal(customerId);
  if (totalSpend >= Number.parseFloat(settings.min_purchase_to_complete)) {
    return completeAndRewardReferral(referral.id);
  }

  return null;
}

/** @param {string} customerId */
async function getCustomerReferralStats(customerId) {
  const [stats, referrals, code] = await Promise.all([
    ReferralRepository.getReferralStats(customerId),
    ReferralRepository.getReferralsByReferrer(customerId),
    getCustomerReferralCode(customerId).catch(() => null),
  ]);

  return {
    ...stats,
    referral_code: code?.code,
    referrals,
  };
}

export const ReferralService = {
  getCustomerReferralCode,
  applyReferralCode,
  completeAndRewardReferral,
  checkAndCompleteReferral,
  getCustomerReferralStats,
  /**
   * @param {string} businessId
   * @param {number} [limit]
   */
  getLeaderboard(businessId, limit = 10) {
    return ReferralRepository.getLeaderboard(businessId, limit);
  },
  /**
   * @param {string} businessId
   * @param {ReferralSettingsInput} settings
   */
  updateSettings(businessId, settings) {
    return ReferralRepository.updateSettings(businessId, settings);
  },
  /** @param {string} businessId */
  getSettings(businessId) {
    return getSettingsWithDefaults(businessId);
  },
};
