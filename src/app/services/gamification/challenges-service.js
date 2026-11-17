import crypto from "node:crypto";

import { GamificationRepository } from "../../repositories/gamification-repository.js";
import { dbQuery, withTransaction } from "../../database.js";
import { notFound } from "../../../utils/http-error.js";
import { lockCustomerGamification } from "./customer-lock.js";
import {
  challengeProgressWrittenAt,
  challengeTimezone,
  hasRecurringWindowElapsed,
  isWindowedRecurrence
} from "./recurrence-window.js";

export { hasRecurringWindowElapsed } from "./recurrence-window.js";

function id() {
  return crypto.randomUUID();
}

async function sourceTransactionIsActive(sourceTransactionId, query = dbQuery) {
  if (!sourceTransactionId) return true;
  const { rows } = await query(
    `SELECT status, reversed_transaction_id
     FROM transactions
     WHERE id = $1
     FOR UPDATE`,
    [sourceTransactionId]
  );
  const tx = rows[0];
  return Boolean(tx && tx.status === "POSTED" && !tx.reversed_transaction_id);
}

async function getCustomerBusiness(customerId, query = dbQuery) {
  const { rows } = await query(
    `SELECT c.business_id, b.program_json
     FROM customers c
     JOIN businesses b ON b.id = c.business_id
     WHERE c.id = $1`,
    [customerId]
  );
  if (!rows[0]) throw notFound("Customer not found");
  return { businessId: rows[0].business_id, timezone: challengeTimezone({ program_json: rows[0].program_json }) };
}

async function awardChallenge(client, businessId, customerId, challenge, context = {}) {
  const rewardTransactionId = id();
  await client.query(
    `UPDATE customer_balances
     SET points = points + $1,
         lifetime_points = lifetime_points + GREATEST($1, 0),
         updated_at = now()
     WHERE customer_id = $2`,
    [challenge.reward_points, customerId]
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
        source_transaction_id: context.sourceTransactionId || null
      })
    ]
  );
  return rewardTransactionId;
}

export function calculateMilestoneCompletionDelta({
  previousProgress: _previousProgress = 0,
  newProgress = 0,
  requirementValue = 0,
  timesCompleted = 0,
  maxCompletions = null
}) {
  const requirement = Number(requirementValue || 0);
  if (!(requirement > 0)) return 0;

  const nextMilestones = Math.floor(Math.max(0, Number(newProgress || 0)) / requirement);
  const completionCap = maxCompletions == null ? nextMilestones : Math.min(nextMilestones, Number(maxCompletions || 0));

  return Math.max(0, completionCap - Math.max(0, Number(timesCompleted || 0)));
}

export async function createChallenge(businessId, challengeData) {
  return GamificationRepository.createChallenge({
    business_id: businessId,
    ...challengeData
  });
}

export async function getCustomerChallenges(customerId, businessId) {
  const rows = await GamificationRepository.getCustomerActiveChallenges(customerId, businessId);
  if (!rows.some((row) => isWindowedRecurrence(row.recurrence))) return rows.map(({ progress_updated_at: _updatedAt, ...row }) => row);
  const { rows: businessRows } = await dbQuery(`SELECT program_json FROM businesses WHERE id = $1`, [businessId]);
  const timezone = challengeTimezone(businessRows[0] || {});
  const now = new Date();
  // Progress from an earlier day, week or month does not count toward the
  // current window, even before the customer's next qualifying purchase.
  return rows.map(({ progress_updated_at: progressUpdatedAt, ...row }) => {
    if (!isWindowedRecurrence(row.recurrence) || row.progress == null) return row;
    const writtenAt = challengeProgressWrittenAt({ ...row, updated_at: progressUpdatedAt });
    if (!hasRecurringWindowElapsed(writtenAt, row.recurrence, now, timezone)) return row;
    return { ...row, progress: 0, completed: false, completed_at: null };
  });
}

export async function updateChallengeProgress(customerId, challengeType, incrementValue = 1, context = {}) {
  return withTransaction(async (client) => {
    const q = client.query.bind(client);
    if (!await sourceTransactionIsActive(context.sourceTransactionId || null, q)) {
      return [];
    }
    // Lock order: source transaction, then the customer's balance row.
    await lockCustomerGamification(q, customerId);
    const { businessId, timezone } = await getCustomerBusiness(customerId, q);
    const challenges = await GamificationRepository.listActiveChallenges(businessId);
    const matchingChallenges = challenges.filter((challenge) => challenge.requirement_type === challengeType);
    const completed = [];

    for (const challenge of matchingChallenges) {
      let progress = await GamificationRepository.getCustomerChallengeProgress(customerId, challenge.id, q);
      if (!progress) progress = { progress: 0, times_completed: 0 };
      if (challenge.max_completions && progress.times_completed >= challenge.max_completions) continue;

      if (challenge.recurrence) {
        const writtenAt = challengeProgressWrittenAt(progress);
        const windowElapsed = !writtenAt || hasRecurringWindowElapsed(writtenAt, challenge.recurrence, new Date(), timezone);
        if (!windowElapsed && progress.completed) continue;
        // Unfinished progress from an earlier day, week or month never carries over.
        const staleProgress = isWindowedRecurrence(challenge.recurrence) && Number(progress.progress || 0) !== 0;
        if (windowElapsed && (progress.completed || staleProgress)) {
          progress = await GamificationRepository.resetRecurringChallengeProgress(customerId, challenge.id, q) || {
            ...progress,
            progress: 0,
            completed: false,
            completed_at: null
          };
        }
      }

      const previousProgress = Number(progress.progress || 0);
      const newProgress = previousProgress + Number(incrementValue || 0);
      if (!await sourceTransactionIsActive(context.sourceTransactionId || null, q)) continue;
      await GamificationRepository.updateChallengeProgress(customerId, challenge.id, newProgress, q);
      if (challenge.recurrence) {
        if (newProgress < Number(challenge.requirement_value || 0)) continue;
        const rewardTransactionId = await awardChallenge(client, businessId, customerId, challenge, context);
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
              completed_at: new Date().toISOString()
            }
          },
          q
        );
        completed.push(challenge);
        continue;
      }

      const completionDelta = calculateMilestoneCompletionDelta({
        previousProgress,
        newProgress,
        requirementValue: challenge.requirement_value,
        timesCompleted: progress.times_completed,
        maxCompletions: challenge.max_completions
      });
      if (completionDelta <= 0) continue;

      for (let index = 0; index < completionDelta; index += 1) {
        const completedAt = new Date().toISOString();
        const rewardTransactionId = await awardChallenge(client, businessId, customerId, challenge, context);
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
              completed_at: completedAt
            }
          },
          q
        );
        completed.push(challenge);
      }
    }

    return completed;
  });
}
