import crypto from "node:crypto";

import { GamificationRepository } from "../../repositories/gamification-repository.js";
import { dbQuery, withTransaction } from "../../database.js";
import { notFound } from "../../../utils/http-error.js";

/** @typedef {import("../../../types/db.js").DbQueryClient} TxClient */
/** @typedef {{ sourceTransactionId?: string | null }} ChallengeContext */
/**
 * challenges row.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   requirement_type: string,
 *   requirement_value: number | string | null,
 *   reward_points: number,
 *   recurrence: string | null,
 *   max_completions: number | null,
 *   active?: boolean,
 *   [key: string]: unknown,
 * }} ChallengeRow
 */

function id() {
  return crypto.randomUUID();
}

/**
 * @param {string | null | undefined} sourceTransactionId
 * @param {typeof dbQuery} [query]
 */
async function sourceTransactionIsActive(sourceTransactionId, query = dbQuery) {
  if (!sourceTransactionId) return true;
  const { rows } = await query(
    `SELECT status, reversed_transaction_id
     FROM transactions
     WHERE id = $1
     FOR UPDATE`,
    [sourceTransactionId],
  );
  const tx = rows[0];
  return Boolean(tx && tx.status === "POSTED" && !tx.reversed_transaction_id);
}

/**
 * @param {string} customerId
 * @param {typeof dbQuery} [query]
 */
async function getCustomerBusinessId(customerId, query = dbQuery) {
  const { rows } = await query(`SELECT business_id FROM customers WHERE id = $1`, [customerId]);
  if (!rows[0]) throw notFound("Cliente no encontrado");
  return rows[0].business_id;
}

/**
 * @param {TxClient} client
 * @param {string} businessId
 * @param {string} customerId
 * @param {ChallengeRow} challenge
 * @param {ChallengeContext} [context]
 */
async function awardChallenge(client, businessId, customerId, challenge, context = {}) {
  const rewardTransactionId = id();
  await client.query(
    `UPDATE customer_balances
     SET points = points + $1,
         lifetime_points = lifetime_points + GREATEST($1, 0),
         updated_at = now()
     WHERE customer_id = $2`,
    [challenge.reward_points, customerId],
  );
  await client.query(
    `INSERT INTO transactions
     (id, business_id, customer_id, type, points, meta)
     VALUES ($1, $2, $3, 'CHALLENGE', $4, $5)`,
    [
      rewardTransactionId,
      businessId,
      customerId,
      challenge.reward_points,
      JSON.stringify({
        challenge_id: challenge.id,
        challenge_name: challenge.name,
        source_transaction_id: context.sourceTransactionId || null,
      }),
    ],
  );
  return rewardTransactionId;
}

export function calculateMilestoneCompletionDelta({
  previousProgress: _previousProgress = 0,
  newProgress = 0,
  requirementValue = 0,
  timesCompleted = 0,
  maxCompletions = null,
}) {
  const requirement = Number(requirementValue || 0);
  if (!(requirement > 0)) return 0;

  const nextMilestones = Math.floor(Math.max(0, Number(newProgress || 0)) / requirement);
  const completionCap =
    maxCompletions == null ? nextMilestones : Math.min(nextMilestones, Number(maxCompletions || 0));

  return Math.max(0, completionCap - Math.max(0, Number(timesCompleted || 0)));
}

/**
 * @param {string | number | Date} date
 * @param {string | null | undefined} recurrence
 */
function recurrenceWindowStart(date, recurrence) {
  const at = new Date(date);
  if (Number.isNaN(at.getTime())) return null;

  if (recurrence === "daily") {
    at.setUTCHours(0, 0, 0, 0);
    return at;
  }

  if (recurrence === "weekly") {
    at.setUTCHours(0, 0, 0, 0);
    const day = at.getUTCDay();
    const diff = (day + 6) % 7;
    at.setUTCDate(at.getUTCDate() - diff);
    return at;
  }

  if (recurrence === "monthly") {
    at.setUTCHours(0, 0, 0, 0);
    at.setUTCDate(1);
    return at;
  }

  return null;
}

/**
 * @param {string | Date | null | undefined} completedAt
 * @param {string | null | undefined} recurrence
 * @param {Date} [now]
 */
export function hasRecurringWindowElapsed(completedAt, recurrence, now = new Date()) {
  if (!completedAt || !recurrence) return true;
  const completedWindow = recurrenceWindowStart(completedAt, recurrence);
  const currentWindow = recurrenceWindowStart(now, recurrence);
  if (!completedWindow || !currentWindow) return true;
  return currentWindow.getTime() > completedWindow.getTime();
}

/**
 * @param {string} businessId
 * @param {Omit<import("../../repositories/gamification-repository.js").ChallengeCreateInput, "business_id"> & { business_id?: string }} challengeData validated route body (GamificationRepository owns the row shape)
 */
export async function createChallenge(businessId, challengeData) {
  return GamificationRepository.createChallenge({
    business_id: businessId,
    ...challengeData,
  });
}

/**
 * @param {string} customerId
 * @param {string} businessId
 */
export async function getCustomerChallenges(customerId, businessId) {
  return GamificationRepository.getCustomerActiveChallenges(customerId, businessId);
}

/**
 * @param {string} customerId
 * @param {string} challengeType
 * @param {number} [incrementValue]
 * @param {ChallengeContext} [context]
 */
export async function updateChallengeProgress(
  customerId,
  challengeType,
  incrementValue = 1,
  context = {},
) {
  return withTransaction(async (/** @type {TxClient} */ client) => {
    const q = client.query.bind(client);
    if (!(await sourceTransactionIsActive(context.sourceTransactionId || null, q))) {
      return [];
    }
    const businessId = await getCustomerBusinessId(customerId, q);
    const challenges = await GamificationRepository.listActiveChallenges(businessId);
    const matchingChallenges = challenges.filter(
      (/** @type {ChallengeRow} */ challenge) => challenge.requirement_type === challengeType,
    );
    const completed = [];

    for (const challenge of matchingChallenges) {
      let progress = await GamificationRepository.getCustomerChallengeProgress(
        customerId,
        challenge.id,
        q,
      );
      if (!progress) progress = { progress: 0, times_completed: 0 };
      if (challenge.max_completions && progress.times_completed >= challenge.max_completions)
        continue;

      if (challenge.recurrence && progress.completed) {
        const windowElapsed = hasRecurringWindowElapsed(
          progress.completed_at || progress.last_reset_at,
          challenge.recurrence,
        );
        if (!windowElapsed) continue;
        progress = (await GamificationRepository.resetRecurringChallengeProgress(
          customerId,
          challenge.id,
          q,
        )) || {
          ...progress,
          progress: 0,
          completed: false,
          completed_at: null,
        };
      }

      const previousProgress = Number(progress.progress || 0);
      const newProgress = previousProgress + Number(incrementValue || 0);
      if (!(await sourceTransactionIsActive(context.sourceTransactionId || null, q))) continue;
      await GamificationRepository.updateChallengeProgress(
        customerId,
        challenge.id,
        newProgress,
        q,
      );
      if (challenge.recurrence) {
        if (newProgress < Number(challenge.requirement_value || 0)) continue;
        const rewardTransactionId = await awardChallenge(
          client,
          businessId,
          customerId,
          challenge,
          context,
        );
        await GamificationRepository.completeChallengeForCustomer(
          customerId,
          challenge.id,
          {
            completedAt: new Date().toISOString(),
            sourceTransactionId: context.sourceTransactionId || null,
            rewardTransactionId,
            historyEntry: {
              source_transaction_id: context.sourceTransactionId || null,
              reward_transaction_id: rewardTransactionId,
              completed_at: new Date().toISOString(),
            },
          },
          q,
        );
        completed.push(challenge);
        continue;
      }

      const completionDelta = calculateMilestoneCompletionDelta({
        previousProgress,
        newProgress,
        requirementValue: challenge.requirement_value,
        timesCompleted: progress.times_completed,
        maxCompletions: challenge.max_completions,
      });
      if (completionDelta <= 0) continue;

      for (let index = 0; index < completionDelta; index += 1) {
        const completedAt = new Date().toISOString();
        const rewardTransactionId = await awardChallenge(
          client,
          businessId,
          customerId,
          challenge,
          context,
        );
        await GamificationRepository.completeChallengeForCustomer(
          customerId,
          challenge.id,
          {
            completedAt,
            sourceTransactionId: context.sourceTransactionId || null,
            rewardTransactionId,
            historyEntry: {
              source_transaction_id: context.sourceTransactionId || null,
              reward_transaction_id: rewardTransactionId,
              completed_at: completedAt,
            },
          },
          q,
        );
        completed.push(challenge);
      }
    }

    return completed;
  });
}
