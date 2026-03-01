import { logger } from "../../utils/logger.js";

export async function runPostAwardHooks({
  deps,
  customerId,
  businessId,
  amountQ,
  visits,
  items
}) {
  try {
    const { TierService } = await deps.loadTierService();
    await TierService.checkTierProgression(customerId);
  } catch (err) {
    logger.warn({ err: err?.message || err, customerId, businessId }, "Tier progression check failed");
  }

  try {
    const { GamificationService } = await deps.loadGamificationService();
    const newAchievements = await GamificationService.checkAndAwardAchievements(customerId, "purchase");
    if (Array.isArray(newAchievements) && newAchievements.length > 0) {
      logger.info({ customerId, count: newAchievements.length, businessId }, "Customer earned achievements");
    }
  } catch (err) {
    logger.warn({ err: err?.message || err, customerId, businessId }, "Achievement check failed");
  }

  try {
    const { GamificationService } = await deps.loadGamificationService();
    if (visits) {
      await GamificationService.updateChallengeProgress(customerId, "visits", visits);
    }
    if (amountQ && amountQ > 0) {
      await GamificationService.updateChallengeProgress(customerId, "spend", 1);
    }
    if (items > 0) {
      await GamificationService.updateChallengeProgress(customerId, "items", items);
    }
  } catch (err) {
    logger.warn({ err: err?.message || err, customerId, businessId }, "Challenge progress update failed");
  }

  try {
    const { ReferralService } = await deps.loadReferralService();
    await ReferralService.checkAndCompleteReferral(customerId);
  } catch (err) {
    logger.warn({ err: err?.message || err, customerId, businessId }, "Referral completion check failed");
  }
}
