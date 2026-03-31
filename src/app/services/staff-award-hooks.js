import { logger } from "../../utils/logger.js";
import { dbQuery } from "../database.js";

async function sourceTransactionIsActive(sourceTransactionId, deps = null) {
  if (!sourceTransactionId) return true;
  if (typeof deps?.isSourceTransactionActive === "function") {
    return Boolean(await deps.isSourceTransactionActive(sourceTransactionId));
  }
  const { rows } = await dbQuery(
    `SELECT status, reversed_transaction_id
     FROM transactions
     WHERE id = $1`,
    [sourceTransactionId]
  );
  const tx = rows[0];
  return Boolean(tx && tx.status === "POSTED" && !tx.reversed_transaction_id);
}

export async function runPostAwardHooks({
  deps,
  customerId,
  businessId,
  sourceTransactionId,
  pointsAwarded,
  amountQ,
  visits,
  items
}) {
  try {
    if (!await sourceTransactionIsActive(sourceTransactionId, deps)) return;
    const { TierService } = await deps.loadTierService();
    await TierService.checkTierProgression(customerId);
  } catch (err) {
    logger.warn({ err: err?.message || err, customerId, businessId }, "Tier progression check failed");
  }

  try {
    if (!await sourceTransactionIsActive(sourceTransactionId, deps)) return;
    const { GamificationService } = await deps.loadGamificationService();
    const newAchievements = await GamificationService.checkAndAwardAchievements(customerId, "purchase", {
      sourceTransactionId
    });
    if (Array.isArray(newAchievements) && newAchievements.length > 0) {
      logger.info({ customerId, count: newAchievements.length, businessId }, "Customer earned achievements");
    }
  } catch (err) {
    logger.warn({ err: err?.message || err, customerId, businessId }, "Achievement check failed");
  }

  try {
    if (!await sourceTransactionIsActive(sourceTransactionId, deps)) return;
    const { GamificationService } = await deps.loadGamificationService();
    if (pointsAwarded && pointsAwarded > 0) {
      await GamificationService.updateChallengeProgress(customerId, "points", pointsAwarded, {
        sourceTransactionId
      });
    }
    if (visits) {
      await GamificationService.updateChallengeProgress(customerId, "visits", visits, {
        sourceTransactionId
      });
    }
    if (amountQ && amountQ > 0) {
      await GamificationService.updateChallengeProgress(customerId, "spend", amountQ, {
        sourceTransactionId
      });
    }
    if (items > 0) {
      await GamificationService.updateChallengeProgress(customerId, "items", items, {
        sourceTransactionId
      });
    }
  } catch (err) {
    logger.warn({ err: err?.message || err, customerId, businessId }, "Challenge progress update failed");
  }

  try {
    if (!await sourceTransactionIsActive(sourceTransactionId, deps)) return;
    const { ReferralService } = await deps.loadReferralService();
    await ReferralService.checkAndCompleteReferral(customerId);
  } catch (err) {
    logger.warn({ err: err?.message || err, customerId, businessId }, "Referral completion check failed");
  }
}
