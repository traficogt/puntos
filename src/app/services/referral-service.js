import { ReferralRepository } from "../repositories/referral-repository.js";
import { dbQuery, withTransaction } from "../database.js";
import { notFound, badRequest, forbidden } from "../../utils/http-error.js";

const DEFAULT_SETTINGS = {
  enabled: false,
  referrer_reward_points: 100,
  referred_reward_points: 50,
  min_purchase_to_complete: null,
  reward_on_signup: false
};

async function getCustomerBusinessId(customerId) {
  const { rows } = await dbQuery(
    `SELECT business_id FROM customers WHERE id = $1`,
    [customerId]
  );
  const customer = rows[0];

  if (!customer) {
    throw notFound("Customer not found");
  }

  return customer.business_id;
}

async function getEnabledSettings(businessId) {
  const settings = await ReferralRepository.getSettings(businessId);

  if (!settings?.enabled) {
    throw forbidden("Referral program is not enabled");
  }

  return settings;
}

function assertReferralCodeUsable(code, newCustomerId, businessId) {
  if (!code) {
    throw notFound("Invalid referral code");
  }

  if (code.business_id !== businessId) {
    throw badRequest("Referral code is for a different business");
  }

  if (code.expires_at && new Date(code.expires_at) < new Date()) {
    throw badRequest("Referral code has expired");
  }

  if (code.max_uses && code.uses_count >= code.max_uses) {
    throw badRequest("Referral code has reached maximum uses");
  }

  if (code.referrer_customer_id === newCustomerId) {
    throw badRequest("You cannot use your own referral code");
  }
}

async function getPurchaseTotal(customerId) {
  const { rows } = await dbQuery(
    `SELECT COALESCE(SUM(amount_q), 0) AS total_spend
     FROM transactions
     WHERE customer_id = $1 AND amount_q IS NOT NULL`,
    [customerId]
  );

  return Number.parseFloat(rows[0]?.total_spend ?? 0);
}

async function getSettingsWithDefaults(businessId) {
  const settings = await ReferralRepository.getSettings(businessId);
  if (settings) {
    return settings;
  }

  return ReferralRepository.updateSettings(businessId, DEFAULT_SETTINGS);
}

async function logReferralReward(client, referral, customerId, points, type) {
  await client.query(
    `INSERT INTO transactions
     (business_id, customer_id, type, points, meta)
     VALUES ($1, $2, 'REFERRAL_REWARD', $3, $4)`,
    [
      referral.business_id,
      customerId,
      points,
      JSON.stringify({ referral_id: referral.id, type })
    ]
  );
}

async function completeAndRewardReferral(referralId) {
  return withTransaction(async (client) => {
    const { rows: referralRows } = await client.query(
      `SELECT * FROM referrals WHERE id = $1`,
      [referralId]
    );
    const referral = referralRows[0];

    if (!referral) {
      throw notFound("Referral not found");
    }

    if (referral.status !== "pending") {
      return referral;
    }

    const { rows: settingsRows } = await client.query(
      `SELECT * FROM referral_settings WHERE business_id = $1`,
      [referral.business_id]
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
       RETURNING *`,
      [referralId, settings.referrer_reward_points, settings.referred_reward_points]
    );

    await client.query(
      `UPDATE customer_balances
       SET points = points + $1, updated_at = now()
       WHERE customer_id = $2`,
      [settings.referrer_reward_points, referral.referrer_customer_id]
    );
    await client.query(
      `UPDATE customer_balances
       SET points = points + $1, updated_at = now()
       WHERE customer_id = $2`,
      [settings.referred_reward_points, referral.referred_customer_id]
    );

    await logReferralReward(
      client,
      referral,
      referral.referrer_customer_id,
      settings.referrer_reward_points,
      "referrer"
    );
    await logReferralReward(
      client,
      referral,
      referral.referred_customer_id,
      settings.referred_reward_points,
      "referred"
    );

    await client.query(
      `UPDATE referrals
       SET status = 'rewarded',
           referrer_rewarded_at = now(),
           referred_rewarded_at = now()
       WHERE id = $1`,
      [referralId]
    );

    return completedRows[0];
  });
}

async function getCustomerReferralCode(customerId) {
  const businessId = await getCustomerBusinessId(customerId);
  await getEnabledSettings(businessId);
  return ReferralRepository.getOrCreateReferralCode(customerId, businessId);
}

async function applyReferralCode(referralCode, newCustomerId, businessId) {
  const code = await ReferralRepository.getByCode(referralCode);
  assertReferralCodeUsable(code, newCustomerId, businessId);

  const existing = await ReferralRepository.getReferralForCustomer(newCustomerId);
  if (existing) {
    throw badRequest("Customer has already been referred");
  }

  const referral = await ReferralRepository.createReferral(
    code.id,
    code.referrer_customer_id,
    newCustomerId,
    businessId
  );

  const settings = await ReferralRepository.getSettings(businessId);
  if (settings?.reward_on_signup) {
    await completeAndRewardReferral(referral.id);
  }

  return referral;
}

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

async function getCustomerReferralStats(customerId) {
  const [stats, referrals, code] = await Promise.all([
    ReferralRepository.getReferralStats(customerId),
    ReferralRepository.getReferralsByReferrer(customerId),
    getCustomerReferralCode(customerId).catch(() => null)
  ]);

  return {
    ...stats,
    referral_code: code?.code,
    referrals
  };
}

export const ReferralService = {
  getCustomerReferralCode,
  applyReferralCode,
  completeAndRewardReferral,
  checkAndCompleteReferral,
  getCustomerReferralStats,
  getLeaderboard(businessId, limit = 10) {
    return ReferralRepository.getLeaderboard(businessId, limit);
  },
  updateSettings(businessId, settings) {
    return ReferralRepository.updateSettings(businessId, settings);
  },
  getSettings(businessId) {
    return getSettingsWithDefaults(businessId);
  }
};
