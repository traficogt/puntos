import { logger } from "../../utils/logger.js";
import { dbQuery } from "../database.js";
import { errorMessage } from "../../utils/error-shape.js";

/**
 * @param {string | null | undefined} sourceTransactionId
 * @param {{ isSourceTransactionActive?: (id: string) => Promise<unknown> | unknown } | null} [deps]
 */
async function sourceTransactionIsActive(sourceTransactionId, deps = null) {
  if (!sourceTransactionId) return true;
  if (typeof deps?.isSourceTransactionActive === "function") {
    return Boolean(await deps.isSourceTransactionActive(sourceTransactionId));
  }
  const { rows } = await dbQuery(
    `SELECT status, reversed_transaction_id
     FROM transactions
     WHERE id = $1`,
    [sourceTransactionId],
  );
  const tx = rows[0];
  return Boolean(tx && tx.status === "POSTED" && !tx.reversed_transaction_id);
}

/**
 * The lazily loaded services an award fans out to. Members are typed by what the
 * hooks call (method style, so a module whose parameters are narrower literal
 * unions still satisfies them). The loaders are optional because several unit
 * tests award without them: a missing loader throws inside the try/catch below
 * and is logged, exactly like a failing hook.
 * @typedef {{
 *   isSourceTransactionActive?: (id: string) => Promise<unknown> | unknown,
 *   loadTierService?: () => Promise<{
 *     TierService: { checkTierProgression(customerId: string): Promise<unknown> }
 *   }>,
 *   loadGamificationService?: () => Promise<{
 *     GamificationService: {
 *       checkAndAwardAchievements(
 *         customerId: string,
 *         eventType: string,
 *         context: { sourceTransactionId: string | null | undefined },
 *       ): Promise<unknown>,
 *       updateChallengeProgress(
 *         customerId: string,
 *         kind: string,
 *         amount: number,
 *         context: { sourceTransactionId: string | null | undefined },
 *       ): Promise<unknown>
 *     }
 *   }>,
 *   loadReferralService?: () => Promise<{
 *     ReferralService: { checkAndCompleteReferral(customerId: string): Promise<unknown> }
 *   }>
 * }} StaffAwardHooksDeps
 */

/**
 * @param {{
 *   deps: StaffAwardHooksDeps,
 *   customerId: string,
 *   businessId: string,
 *   sourceTransactionId: string | null | undefined,
 *   pointsAwarded: number,
 *   amountQ: number,
 *   visits: number,
 *   items: number
 * }} award
 */
export async function runPostAwardHooks({
  deps,
  customerId,
  businessId,
  sourceTransactionId,
  pointsAwarded,
  amountQ,
  visits,
  items,
}) {
  try {
    if (!(await sourceTransactionIsActive(sourceTransactionId, deps))) return;
    const { TierService } =
      await /** @type {NonNullable<StaffAwardHooksDeps["loadTierService"]>} */ (
        deps.loadTierService
      )();
    await TierService.checkTierProgression(customerId);
  } catch (err) {
    logger.warn(
      { err: errorMessage(err) || err, customerId, businessId },
      "Tier progression check failed",
    );
  }

  try {
    if (!(await sourceTransactionIsActive(sourceTransactionId, deps))) return;
    const { GamificationService } =
      await /** @type {NonNullable<StaffAwardHooksDeps["loadGamificationService"]>} */ (
        deps.loadGamificationService
      )();
    const newAchievements = await GamificationService.checkAndAwardAchievements(
      customerId,
      "purchase",
      {
        sourceTransactionId,
      },
    );
    if (Array.isArray(newAchievements) && newAchievements.length > 0) {
      logger.info(
        { customerId, count: newAchievements.length, businessId },
        "Customer earned achievements",
      );
    }
  } catch (err) {
    logger.warn(
      { err: errorMessage(err) || err, customerId, businessId },
      "Achievement check failed",
    );
  }

  try {
    if (!(await sourceTransactionIsActive(sourceTransactionId, deps))) return;
    const { GamificationService } =
      await /** @type {NonNullable<StaffAwardHooksDeps["loadGamificationService"]>} */ (
        deps.loadGamificationService
      )();
    if (pointsAwarded && pointsAwarded > 0) {
      await GamificationService.updateChallengeProgress(customerId, "points", pointsAwarded, {
        sourceTransactionId,
      });
    }
    if (visits) {
      await GamificationService.updateChallengeProgress(customerId, "visits", visits, {
        sourceTransactionId,
      });
    }
    if (amountQ && amountQ > 0) {
      await GamificationService.updateChallengeProgress(customerId, "spend", amountQ, {
        sourceTransactionId,
      });
    }
    if (items > 0) {
      await GamificationService.updateChallengeProgress(customerId, "items", items, {
        sourceTransactionId,
      });
    }
  } catch (err) {
    logger.warn(
      { err: errorMessage(err) || err, customerId, businessId },
      "Challenge progress update failed",
    );
  }

  try {
    if (!(await sourceTransactionIsActive(sourceTransactionId, deps))) return;
    const { ReferralService } =
      await /** @type {NonNullable<StaffAwardHooksDeps["loadReferralService"]>} */ (
        deps.loadReferralService
      )();
    await ReferralService.checkAndCompleteReferral(customerId);
  } catch (err) {
    logger.warn(
      { err: errorMessage(err) || err, customerId, businessId },
      "Referral completion check failed",
    );
  }
}
