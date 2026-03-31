import crypto from "node:crypto";

import { getCustomerGamificationStats } from "./customer-stats.js";
import { achievementProgressValue } from "./achievements-service.js";
import { hasRecurringWindowElapsed } from "./challenges-service.js";

function id() {
  return crypto.randomUUID();
}

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

function recurrenceWindowEnd(start, recurrence) {
  if (!start) return null;
  const end = new Date(start);

  if (recurrence === "daily") {
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
  }

  if (recurrence === "weekly") {
    end.setUTCDate(end.getUTCDate() + 7);
    return end;
  }

  if (recurrence === "monthly") {
    end.setUTCMonth(end.getUTCMonth() + 1);
    return end;
  }

  return null;
}

function uniqueTransactions(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

function normalizeCompletionHistory(history) {
  if (Array.isArray(history)) return history.filter((entry) => entry && typeof entry === "object");
  if (typeof history === "string") {
    try {
      const parsed = JSON.parse(history);
      return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function latestCompletionEntry(entries) {
  const normalized = normalizeCompletionHistory(entries);
  return normalized.length ? normalized[normalized.length - 1] : null;
}

function removeCompletionEntries(entries, entriesToRemove) {
  const removals = new Set((entriesToRemove || []).map((entry) => JSON.stringify(entry)));
  return normalizeCompletionHistory(entries).filter((entry) => !removals.has(JSON.stringify(entry)));
}

async function getTransactionById(client, transactionId) {
  if (!transactionId) return null;
  const { rows } = await client.query(
    `SELECT *
     FROM transactions
     WHERE id = $1
       AND status <> 'REVERSED'
       AND NOT EXISTS (
         SELECT 1
         FROM transactions r
         WHERE r.original_transaction_id = transactions.id
       )`,
    [transactionId]
  );
  return rows[0] || null;
}

export function expectedNonRecurringChallengeCompletions(currentValue, requirementValue, maxCompletions = null) {
  const requirement = Number(requirementValue || 0);
  if (!(requirement > 0)) return 0;
  const rawCompletions = Math.floor(Math.max(0, Number(currentValue || 0)) / requirement);
  return maxCompletions == null ? rawCompletions : Math.min(rawCompletions, Number(maxCompletions || 0));
}

export function shouldRevokeRecurringChallengeCompletion({
  currentValue,
  requirementValue,
  completed,
  completedAt,
  recurrence,
  referenceAt
}) {
  if (!completed || !recurrence) return false;
  if (hasRecurringWindowElapsed(completedAt, recurrence, referenceAt)) return false;
  return Number(currentValue || 0) < Number(requirementValue || 0);
}

async function getCurrentAchievementRows(client, customerId) {
  const { rows } = await client.query(
    `SELECT
       ca.achievement_id,
       ca.earned_at,
       ca.source_transaction_id,
       ca.reward_transaction_id,
       a.business_id,
       a.name,
       a.requirement_type,
       a.requirement_value,
       a.points_reward
     FROM customer_achievements ca
     JOIN achievements a ON a.id = ca.achievement_id
     WHERE ca.customer_id = $1
     ORDER BY a.requirement_value DESC, ca.earned_at DESC`,
    [customerId]
  );
  return rows;
}

async function getCurrentChallengeRows(client, customerId) {
  const { rows } = await client.query(
    `SELECT
       cc.challenge_id,
       cc.progress,
       cc.completed,
       cc.completed_at,
       cc.times_completed,
       cc.last_reset_at,
       cc.last_source_transaction_id,
       cc.last_reward_transaction_id,
       cc.completion_history,
       c.business_id,
       c.name,
       c.requirement_type,
       c.requirement_value,
       c.reward_points,
       c.recurrence,
       c.max_completions
     FROM customer_challenges cc
     JOIN challenges c ON c.id = cc.challenge_id
     WHERE cc.customer_id = $1
     ORDER BY cc.updated_at DESC`,
    [customerId]
  );
  return rows;
}

async function getRewardTransactions(client, {
  customerId,
  businessId,
  type,
  entityField,
  entityId,
  sourceTransactionId = null,
  limit = 1,
  startAt = null,
  endAt = null
}) {
  const params = [customerId, businessId, type, entityField, entityId];
  let where = `
    t.customer_id = $1
    AND t.business_id = $2
    AND t.type = $3
    AND t.meta->>$4 = $5
    AND t.status <> 'REVERSED'
    AND NOT EXISTS (
      SELECT 1
      FROM transactions r
      WHERE r.original_transaction_id = t.id
    )`;

  if (sourceTransactionId) {
    params.push(sourceTransactionId);
    where += ` AND t.meta->>'source_transaction_id' = $${params.length}`;
  }

  if (startAt) {
    params.push(startAt);
    where += ` AND t.created_at >= $${params.length}`;
  }
  if (endAt) {
    params.push(endAt);
    where += ` AND t.created_at < $${params.length}`;
  }
  params.push(limit);

  const { rows } = await client.query(
    `SELECT t.*
     FROM transactions t
     WHERE ${where}
     ORDER BY t.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function reverseRewardTransaction(client, tx, staff, reason, meta = {}) {
  const points = Number(tx.points || 0);
  const pointsEffect = -points;

  await client.query(
    `UPDATE customer_balances
     SET points = points + $2,
         updated_at = now()
     WHERE customer_id = $1`,
    [tx.customer_id, pointsEffect]
  );

  const reversalId = id();
  await client.query(
    `INSERT INTO transactions
     (id, business_id, branch_id, customer_id, staff_user_id, amount_q, visits, items, type, points, status, source, original_transaction_id, meta)
     VALUES ($1,$2,$3,$4,$5,0,0,0,$6,$7,'POSTED','reversal',$8,$9)`,
    [
      reversalId,
      tx.business_id,
      tx.branch_id,
      tx.customer_id,
      staff.id,
      tx.type,
      pointsEffect,
      tx.id,
      {
        refund_reason: reason,
        original_status: tx.status,
        original_points: points,
        refunded_by: staff.id,
        correction: meta
      }
    ]
  );

  await client.query(
    `UPDATE transactions
     SET status = 'REVERSED',
         reversed_transaction_id = $2,
         reversal_reason = $3
     WHERE id = $1`,
    [tx.id, reversalId, reason]
  );

  return reversalId;
}

async function getChallengeMetricValue(client, customerId, requirementType, startAt = null, endAt = null, stats = null) {
  if (!startAt && !endAt && stats) {
    if (requirementType === "points") {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(points), 0) AS total_points
         FROM transactions
         WHERE customer_id = $1
           AND type = 'PURCHASE'
           AND source <> 'reversal'
           AND status <> 'REVERSED'`,
        [customerId]
      );
      return Number(rows?.[0]?.total_points || 0);
    }

    return achievementProgressValue(stats, requirementType);
  }

  if (requirementType === "referrals") {
    const params = [customerId, startAt, endAt];
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM referrals
       WHERE referrer_customer_id = $1
         AND status = 'completed'
         AND completed_at >= $2
         AND completed_at < $3`,
      params
    );
    return Number(rows?.[0]?.total || 0);
  }

  if (requirementType === "streak") {
    return Number(stats?.current_streak || 0);
  }

  const metricColumn = requirementType === "spend"
    ? "COALESCE(SUM(amount_q), 0)::numeric(10,2)"
    : requirementType === "visits"
      ? "COALESCE(SUM(visits), 0)::int"
      : requirementType === "items"
        ? "COALESCE(SUM(items), 0)::int"
        : "COALESCE(SUM(points), 0)::int";
  const typeFilter = requirementType === "points" ? `AND type = 'PURCHASE'` : "";

  const { rows } = await client.query(
    `SELECT ${metricColumn} AS total
     FROM transactions
     WHERE customer_id = $1
       AND created_at >= $2
       AND created_at < $3
       AND source <> 'reversal'
       AND status <> 'REVERSED'
       ${typeFilter}`,
    [customerId, startAt, endAt]
  );
  return Number(rows?.[0]?.total || 0);
}

async function reconcileAchievements(client, customerId, staff, reason, _referenceAt = null, refundedTransactionId = null) {
  let revokedCount = 0;

  for (;;) {
    const stats = await getCustomerGamificationStats(customerId, client.query.bind(client));
    const achievements = await getCurrentAchievementRows(client, customerId);
    let revokedThisPass = false;

    for (const achievement of achievements) {
      const currentValue = achievementProgressValue(stats, achievement.requirement_type);
      if (currentValue >= Number(achievement.requirement_value || 0)) continue;

      await client.query(
        `DELETE FROM customer_achievements
         WHERE customer_id = $1 AND achievement_id = $2`,
        [customerId, achievement.achievement_id]
      );

      const rewardTx = await getTransactionById(client, achievement.reward_transaction_id)
        || (await getRewardTransactions(client, {
          customerId,
          businessId: achievement.business_id,
          type: "ACHIEVEMENT",
          entityField: "achievement_id",
          entityId: achievement.achievement_id,
          sourceTransactionId: refundedTransactionId,
          limit: 1
        }))[0]
        || (await getRewardTransactions(client, {
          customerId,
          businessId: achievement.business_id,
          type: "ACHIEVEMENT",
          entityField: "achievement_id",
          entityId: achievement.achievement_id,
          limit: 1
        }))[0];
      if (rewardTx && Number(rewardTx.points || 0) !== 0) {
        await reverseRewardTransaction(client, rewardTx, staff, reason, {
          category: "achievement_revoke",
          achievement_id: achievement.achievement_id
        });
      }

      revokedCount += 1;
      revokedThisPass = true;
      break;
    }

    if (!revokedThisPass) break;
  }

  return revokedCount;
}

async function reconcileChallenges(client, customerId, staff, reason, referenceAt, refundedTransactionId = null) {
  const stats = await getCustomerGamificationStats(customerId, client.query.bind(client));
  const challenges = await getCurrentChallengeRows(client, customerId);
  let revokedCount = 0;

  for (const challenge of challenges) {
    const history = normalizeCompletionHistory(challenge.completion_history);

    if (challenge.recurrence) {
      const matchingEntries = refundedTransactionId
        ? history.filter((entry) => entry.source_transaction_id === refundedTransactionId)
        : [];
      const entriesToRevoke = [];

      for (const entry of matchingEntries) {
        const windowStart = recurrenceWindowStart(entry.completed_at, challenge.recurrence);
        const windowEnd = recurrenceWindowEnd(windowStart, challenge.recurrence);
        if (!windowStart || !windowEnd) continue;

        const windowValue = await getChallengeMetricValue(
          client,
          customerId,
          challenge.requirement_type,
          windowStart,
          windowEnd,
          stats
        );
        if (windowValue >= Number(challenge.requirement_value || 0)) continue;
        entriesToRevoke.push(entry);
      }

      for (const entry of entriesToRevoke) {
        const rewardTx = await getTransactionById(client, entry.reward_transaction_id)
          || (await getRewardTransactions(client, {
            customerId,
            businessId: challenge.business_id,
            type: "CHALLENGE",
            entityField: "challenge_id",
            entityId: challenge.challenge_id,
            sourceTransactionId: entry.source_transaction_id || refundedTransactionId,
            limit: 1,
            startAt: recurrenceWindowStart(entry.completed_at, challenge.recurrence),
            endAt: recurrenceWindowEnd(recurrenceWindowStart(entry.completed_at, challenge.recurrence), challenge.recurrence)
          }))[0];
        if (rewardTx && Number(rewardTx.points || 0) !== 0) {
          await reverseRewardTransaction(client, rewardTx, staff, reason, {
            category: "challenge_revoke",
            challenge_id: challenge.challenge_id
          });
        }
      }

      const remainingHistory = removeCompletionEntries(history, entriesToRevoke);
      const currentWindowStart = recurrenceWindowStart(referenceAt, challenge.recurrence);
      const currentWindowEnd = recurrenceWindowEnd(currentWindowStart, challenge.recurrence);
      const currentWindowEntry = remainingHistory.find((entry) => {
        const completedAt = new Date(entry.completed_at || "");
        return currentWindowStart && currentWindowEnd
          && !Number.isNaN(completedAt.getTime())
          && completedAt >= currentWindowStart
          && completedAt < currentWindowEnd;
      }) || null;
      const currentValue = currentWindowStart && currentWindowEnd
        ? await getChallengeMetricValue(client, customerId, challenge.requirement_type, currentWindowStart, currentWindowEnd, stats)
        : Number(challenge.progress || 0);
      const lastEntry = latestCompletionEntry(remainingHistory);

      await client.query(
        `UPDATE customer_challenges
         SET progress = $3,
             completed = $4,
             completed_at = $5,
             times_completed = $6,
             last_source_transaction_id = $7,
             last_reward_transaction_id = $8,
             completion_history = $9::jsonb,
             updated_at = now()
         WHERE customer_id = $1 AND challenge_id = $2`,
        [
          customerId,
          challenge.challenge_id,
          currentValue,
          Boolean(currentWindowEntry),
          currentWindowEntry?.completed_at || null,
          remainingHistory.length,
          lastEntry?.source_transaction_id || null,
          lastEntry?.reward_transaction_id || null,
          JSON.stringify(remainingHistory)
        ]
      );

      revokedCount += entriesToRevoke.length;
      continue;
    }

    const currentValue = await getChallengeMetricValue(
      client,
      customerId,
      challenge.requirement_type,
      null,
      null,
      stats
    );
    const expectedTimesCompleted = expectedNonRecurringChallengeCompletions(
      currentValue,
      challenge.requirement_value,
      challenge.max_completions
    );
    const actualTimesCompleted = Number(challenge.times_completed || 0);
    const excessCompletions = Math.max(0, actualTimesCompleted - expectedTimesCompleted);
    const orderedHistory = [...history].reverse();
    const exactMatches = refundedTransactionId
      ? orderedHistory.filter((entry) => entry.source_transaction_id === refundedTransactionId)
      : [];
    const fallbackEntries = orderedHistory.filter((entry) => !exactMatches.includes(entry));
    const entriesToRevoke = [...exactMatches, ...fallbackEntries].slice(0, excessCompletions);
    const remainingHistory = removeCompletionEntries(history, entriesToRevoke);
    const rewardTransactions = [];

    for (const entry of entriesToRevoke) {
      const rewardTx = await getTransactionById(client, entry.reward_transaction_id)
        || (await getRewardTransactions(client, {
          customerId,
          businessId: challenge.business_id,
          type: "CHALLENGE",
          entityField: "challenge_id",
          entityId: challenge.challenge_id,
          sourceTransactionId: entry.source_transaction_id || refundedTransactionId,
          limit: 1
        }))[0];
      if (rewardTx) rewardTransactions.push(rewardTx);
    }

    if (rewardTransactions.length < excessCompletions) {
      const fallbackRewardTxs = await getRewardTransactions(client, {
        customerId,
        businessId: challenge.business_id,
        type: "CHALLENGE",
        entityField: "challenge_id",
        entityId: challenge.challenge_id,
        limit: excessCompletions
      });
      rewardTransactions.push(...fallbackRewardTxs);
    }

    for (const tx of uniqueTransactions(rewardTransactions).slice(0, excessCompletions)) {
      if (Number(tx.points || 0) === 0) continue;
      await reverseRewardTransaction(client, tx, staff, reason, {
        category: "challenge_revoke",
        challenge_id: challenge.challenge_id
      });
    }
    const lastEntry = latestCompletionEntry(remainingHistory);
    await client.query(
      `UPDATE customer_challenges
       SET progress = $3,
           completed = $4,
           completed_at = $5,
           times_completed = $6,
           last_source_transaction_id = $7,
           last_reward_transaction_id = $8,
           completion_history = $9::jsonb,
           updated_at = now()
       WHERE customer_id = $1 AND challenge_id = $2`,
      [
        customerId,
        challenge.challenge_id,
        currentValue,
        expectedTimesCompleted > 0,
        lastEntry?.completed_at || (expectedTimesCompleted > 0 ? challenge.completed_at : null),
        expectedTimesCompleted,
        lastEntry?.source_transaction_id || null,
        lastEntry?.reward_transaction_id || null,
        JSON.stringify(remainingHistory)
      ]
    );
    revokedCount += excessCompletions;
  }

  return revokedCount;
}

export async function reconcileCustomerGamificationAfterRefund(client, {
  customerId,
  staff,
  reason,
  referenceAt = new Date(),
  refundedTransactionId = null
}) {
  const achievementsRevoked = await reconcileAchievements(client, customerId, staff, reason, referenceAt, refundedTransactionId);
  const challengesRevoked = await reconcileChallenges(client, customerId, staff, reason, referenceAt, refundedTransactionId);

  return {
    achievementsRevoked,
    challengesRevoked
  };
}
