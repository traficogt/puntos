import { ReferralRepository } from "../repositories/referral-repository.js";
import { dbQuery, withTransaction } from "../database.js";
import { notFound, badRequest, forbidden } from "../../utils/http-error.js";
import { hasPlanFeature } from "../../utils/plan.js";
import { PlanConfigService } from "./plan-config-service.js";
import { lockCustomerGamification } from "./gamification/customer-lock.js";
import { getSettledPurchaseSummary, referralPurchaseRequirementMet } from "./gamification/settled-purchase.js";

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

function loadPlanFeatureOverrides(deps) {
  const load = deps?.getPlanFeatureOverrides ?? (() => PlanConfigService.getPlanFeatureOverrides());
  return Promise.resolve(load()).catch(() => ({}));
}

// The owner's switch and the plan both gate the program at the moment points
// would move, not only when the customer opens the wallet.
async function referralProgramActive(client, businessId, overrides) {
  const { rows: settingsRows } = await client.query(
    `SELECT * FROM referral_settings WHERE business_id = $1`,
    [businessId]
  );
  const settings = settingsRows[0] ?? null;
  if (!settings?.enabled) return { active: false, settings };
  const { rows: businessRows } = await client.query(
    `SELECT plan FROM businesses WHERE id = $1`,
    [businessId]
  );
  const business = businessRows[0];
  return { active: Boolean(business && hasPlanFeature(business.plan, "referrals", overrides)), settings };
}

async function getSettingsWithDefaults(businessId) {
  const settings = await ReferralRepository.getSettings(businessId);
  if (settings) {
    return settings;
  }

  return ReferralRepository.updateSettings(businessId, DEFAULT_SETTINGS);
}

async function logReferralReward(client, referral, customerId, points, type, qualification) {
  await client.query(
    `INSERT INTO transactions
     (business_id, customer_id, type, points, meta)
     VALUES ($1, $2, 'REFERRAL_REWARD', $3, $4)`,
    [
      referral.business_id,
      customerId,
      points,
      // Refund reconciliation reads how this reward qualified.
      JSON.stringify({ referral_id: referral.id, type, ...qualification })
    ]
  );
}

/**
 * @param {{ withTransaction: Function, getPlanFeatureOverrides?: Function }} deps
 * @param {string} referralId
 * @param {{ trigger?: "purchase" | "signup" }} [options]
 */
export async function completeAndRewardReferralWithDeps(deps, referralId, { trigger = "purchase" } = {}) {
  const overrides = await loadPlanFeatureOverrides(deps);
  return deps.withTransaction(async (client) => {
    const { rows: targetRows } = await client.query(
      `SELECT referred_customer_id FROM referrals WHERE id = $1`,
      [referralId]
    );
    if (!targetRows[0]) {
      throw notFound("Referral not found");
    }
    // Refunds lock the referred customer's balance before this referral.
    await lockCustomerGamification(client.query.bind(client), targetRows[0].referred_customer_id);

    const { rows: referralRows } = await client.query(
      `SELECT * FROM referrals WHERE id = $1 FOR UPDATE`,
      [referralId]
    );
    const referral = referralRows[0];

    if (!referral) {
      throw notFound("Referral not found");
    }

    if (referral.status !== "pending") {
      return referral;
    }

    const { active, settings } = await referralProgramActive(client, referral.business_id, overrides);
    // A disabled program pays nothing; the referral stays pending.
    if (!active) {
      return referral;
    }

    const minPurchase = trigger === "purchase" ? (settings.min_purchase_to_complete ?? null) : null;
    if (trigger === "purchase") {
      const purchases = await getSettledPurchaseSummary(client.query.bind(client), referral.referred_customer_id);
      if (!referralPurchaseRequirementMet(purchases, minPurchase)) {
        return referral;
      }
    }
    const qualification = { trigger, min_purchase_to_complete: minPurchase };

    const { rows: completedRows } = await client.query(
      `UPDATE referrals
       SET status = 'completed',
           completed_at = now(),
           referrer_reward_points = $2,
           referred_reward_points = $3
       WHERE id = $1
         AND status = 'pending'
       RETURNING *`,
      [referralId, settings.referrer_reward_points, settings.referred_reward_points]
    );
    const completedReferral = completedRows[0];

    if (!completedReferral) {
      const { rows: latestRows } = await client.query(
        `SELECT * FROM referrals WHERE id = $1`,
        [referralId]
      );
      return latestRows[0] ?? referral;
    }

    await client.query(
      `UPDATE customer_balances
       SET points = points + $1,
           lifetime_points = lifetime_points + GREATEST($1, 0),
           updated_at = now()
       WHERE customer_id = $2`,
      [settings.referrer_reward_points, referral.referrer_customer_id]
    );
    await client.query(
      `UPDATE customer_balances
       SET points = points + $1,
           lifetime_points = lifetime_points + GREATEST($1, 0),
           updated_at = now()
       WHERE customer_id = $2`,
      [settings.referred_reward_points, referral.referred_customer_id]
    );

    await logReferralReward(
      client,
      referral,
      referral.referrer_customer_id,
      settings.referrer_reward_points,
      "referrer",
      qualification
    );
    await logReferralReward(
      client,
      referral,
      referral.referred_customer_id,
      settings.referred_reward_points,
      "referred",
      qualification
    );

    await client.query(
      `UPDATE referrals
       SET status = 'rewarded',
           referrer_rewarded_at = now(),
           referred_rewarded_at = now()
       WHERE id = $1
       RETURNING *`,
      [referralId]
    );
    const { rows: rewardedRows } = await client.query(
      `SELECT * FROM referrals WHERE id = $1`,
      [referralId]
    );
    return rewardedRows[0] ?? completedReferral;
  });
}

async function completeAndRewardReferral(referralId, options = {}) {
  return completeAndRewardReferralWithDeps({ withTransaction }, referralId, options);
}

async function getCustomerReferralCode(customerId) {
  const businessId = await getCustomerBusinessId(customerId);
  await getEnabledSettings(businessId);
  return ReferralRepository.getOrCreateReferralCode(customerId, businessId);
}

export async function applyReferralCodeWithDeps(deps, referralCode, newCustomerId, businessId) {
  const overrides = await loadPlanFeatureOverrides(deps);
  const { referral, settings } = await deps.withTransaction(async (client) => {
    const program = await referralProgramActive(client, businessId, overrides);
    if (!program.active) {
      throw forbidden("Referral program is not enabled");
    }

    const { rows: codeRows } = await client.query(
      `SELECT *
       FROM referral_codes
       WHERE code = $1
         AND active = true
       FOR UPDATE`,
      [String(referralCode || "").toUpperCase()]
    );
    const code = codeRows[0];
    assertReferralCodeUsable(code, newCustomerId, businessId);

    const existing = await client.query(
      `SELECT id
       FROM referrals
       WHERE referred_customer_id = $1
       LIMIT 1`,
      [newCustomerId]
    );
    if (existing.rowCount > 0) {
      throw badRequest("Customer has already been referred");
    }

    const codeUpdate = await client.query(
      `UPDATE referral_codes
       SET uses_count = uses_count + 1
       WHERE id = $1
         AND (max_uses IS NULL OR uses_count < max_uses)
       RETURNING *`,
      [code.id]
    );
    if (codeUpdate.rowCount !== 1) {
      throw badRequest("Referral code has reached maximum uses");
    }

    let createdReferral;
    try {
      const { rows } = await client.query(
        `INSERT INTO referrals
         (business_id, referral_code_id, referrer_customer_id, referred_customer_id, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [businessId, code.id, code.referrer_customer_id, newCustomerId]
      );
      createdReferral = rows[0];
    } catch (error) {
      if (String(error?.code) === "23505") {
        throw badRequest("Customer has already been referred");
      }
      throw error;
    }

    return {
      referral: createdReferral,
      settings: program.settings
    };
  });

  if (settings?.reward_on_signup) {
    await completeAndRewardReferralWithDeps(deps, referral.id, { trigger: "signup" });
  }

  return referral;
}

async function applyReferralCode(referralCode, newCustomerId, businessId) {
  return applyReferralCodeWithDeps({ withTransaction }, referralCode, newCustomerId, businessId);
}

async function checkAndCompleteReferral(customerId) {
  const referral = await ReferralRepository.getReferralForCustomer(customerId);
  if (!referral || referral.status !== "pending") {
    return null;
  }

  const settings = await ReferralRepository.getSettings(referral.business_id);
  if (!settings?.enabled) {
    return null;
  }

  // The program, plan and settled-purchase requirement are rechecked while
  // the reward transaction holds the customer and referral locks.
  const result = await completeAndRewardReferral(referral.id, { trigger: "purchase" });
  return result?.status === "pending" ? null : result;
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
