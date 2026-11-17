import crypto from "node:crypto";

import { logger } from "../../../utils/logger.js";
import { getCustomerGamificationStats } from "./customer-stats.js";
import { lockCustomerGamification } from "./customer-lock.js";
import { achievementProgressValue } from "./achievements-service.js";
import {
  challengeProgressWrittenAt,
  challengeTimezone,
  hasRecurringWindowElapsed,
  recurrenceWindowEnd,
  recurrenceWindowStart
} from "./recurrence-window.js";
import { getSettledPurchaseSummary, referralPurchaseRequirementMet, settledPurchase } from "./settled-purchase.js";

function id() {
  return crypto.randomUUID();
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
  referenceAt,
  timezone = undefined
}) {
  if (!completed || !recurrence) return false;
  if (hasRecurringWindowElapsed(completedAt, recurrence, referenceAt, timezone)) return false;
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
       cc.updated_at,
       c.business_id,
       c.name,
       c.requirement_type,
       c.requirement_value,
       c.reward_points,
       c.recurrence,
       c.max_completions,
       c.start_date,
       c.end_date
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
  // Expiry already deducted what remained of an expired reward through its own
  // 'expire' row. As with staff refunds, the expired original is not deducted
  // again and keeps its ledger effect; only the milestone itself is revoked.
  if (tx.status === "EXPIRED" || tx.expired_at) return null;
  const points = Number(tx.points || 0);
  const pointsEffect = -points;

  // A POSTED reward counted toward lifetime points; reversing it removes it
  // there too, as staff refunds do. The reversal records that it did, so the
  // ledger expectation (ledgerExpectationSql) reduces lifetime for it as well.
  const lifetimeEffect = tx.status === "POSTED" ? -Math.max(points, 0) : 0;
  await client.query(
    `UPDATE customer_balances
     SET points = points + $2,
         lifetime_points = GREATEST(0, lifetime_points + $3),
         updated_at = now()
     WHERE customer_id = $1`,
    [tx.customer_id, pointsEffect, lifetimeEffect]
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
        correction: meta,
        lifetime_reversed: lifetimeEffect !== 0
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

function timeBoundsSql(params, column, { startAt = null, endAt = null, endInclusive = false } = {}) {
  let sql = "";
  if (startAt) {
    params.push(startAt);
    sql += ` AND ${column} >= $${params.length}`;
  }
  if (endAt) {
    params.push(endAt);
    sql += ` AND ${column} ${endInclusive ? "<=" : "<"} $${params.length}`;
  }
  return sql;
}

// The challenge's own dates bound every measurement; a recurring window is
// intersected with them. Challenges count through their end date inclusive.
function challengeBounds(challenge, windowStart = null, windowEnd = null) {
  const challengeStart = challenge.start_date ? new Date(challenge.start_date) : null;
  const challengeEnd = challenge.end_date ? new Date(challenge.end_date) : null;
  const startAt = challengeStart && (!windowStart || challengeStart > windowStart) ? challengeStart : windowStart;
  if (challengeEnd && (!windowEnd || challengeEnd < windowEnd)) {
    return { startAt, endAt: challengeEnd, endInclusive: true };
  }
  return { startAt, endAt: windowEnd, endInclusive: false };
}

const PURCHASE_METRICS = Object.freeze({
  spend: "ROUND(COALESCE(SUM(t.amount_q), 0), 2)",
  visits: "COALESCE(SUM(t.visits), 0)::int",
  items: "COALESCE(SUM(t.items), 0)::int",
  points: "COALESCE(SUM(GREATEST(t.points, 0)), 0)::int"
});

// Measures only what challenge progress counts: settled purchases (or
// completed referrals) inside the bounds. Returns null for requirement types
// that purchases never advance, so their rows are left untouched.
async function getChallengeMetricValue(client, customerId, requirementType, bounds = {}) {
  if (requirementType === "referrals") {
    const params = [customerId];
    const timeSql = timeBoundsSql(params, "completed_at", bounds);
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM referrals
       WHERE referrer_customer_id = $1
         AND status IN ('completed', 'rewarded')${timeSql}`,
      params
    );
    return Number(rows?.[0]?.total || 0);
  }

  const metricColumn = PURCHASE_METRICS[requirementType];
  if (!metricColumn) return null;
  const params = [customerId];
  const timeSql = timeBoundsSql(params, "t.created_at", bounds);
  const { rows } = await client.query(
    `SELECT ${metricColumn} AS total
     FROM transactions t
     WHERE t.customer_id = $1
       AND ${settledPurchase("t")}${timeSql}`,
    params
  );
  return Number(rows?.[0]?.total || 0);
}

const MEASURED_ACHIEVEMENT_TYPES = new Set(["points", "spend", "visits", "items", "referrals", "streak"]);

async function reconcileAchievements(client, customerId, staff, reason, _referenceAt = null, refundedTransactionId = null) {
  let revokedCount = 0;

  for (;;) {
    const stats = await getCustomerGamificationStats(customerId, client.query.bind(client));
    const achievements = await getCurrentAchievementRows(client, customerId);
    let revokedThisPass = false;

    for (const achievement of achievements) {
      // Only measurable requirements can be re-evaluated after a refund.
      if (!MEASURED_ACHIEVEMENT_TYPES.has(achievement.requirement_type)) continue;
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

function completionWithinBounds(entry, bounds) {
  const completedAt = new Date(entry?.completed_at || "");
  if (Number.isNaN(completedAt.getTime())) return false;
  if (bounds.startAt && completedAt < bounds.startAt) return false;
  if (bounds.endAt && (bounds.endInclusive ? completedAt > bounds.endAt : completedAt >= bounds.endAt)) return false;
  return true;
}

async function reconcileRecurringChallenge(client, challenge, history, { customerId, staff, reason, referenceAt, refundedTransactionId, timezone }) {
  const matchingEntries = refundedTransactionId
    ? history.filter((entry) => entry.source_transaction_id === refundedTransactionId)
    : [];
  const entriesToRevoke = [];

  for (const entry of matchingEntries) {
    const windowStart = recurrenceWindowStart(entry.completed_at, challenge.recurrence, timezone);
    const windowEnd = recurrenceWindowEnd(windowStart, challenge.recurrence, timezone);
    if (!windowStart || !windowEnd) continue;

    const windowValue = await getChallengeMetricValue(
      client,
      customerId,
      challenge.requirement_type,
      challengeBounds(challenge, windowStart, windowEnd)
    );
    if (windowValue == null || windowValue >= Number(challenge.requirement_value || 0)) continue;
    entriesToRevoke.push(entry);
  }

  for (const entry of entriesToRevoke) {
    const windowStart = recurrenceWindowStart(entry.completed_at, challenge.recurrence, timezone);
    const rewardTx = await getTransactionById(client, entry.reward_transaction_id)
      || (await getRewardTransactions(client, {
        customerId,
        businessId: challenge.business_id,
        type: "CHALLENGE",
        entityField: "challenge_id",
        entityId: challenge.challenge_id,
        sourceTransactionId: entry.source_transaction_id || refundedTransactionId,
        limit: 1,
        startAt: windowStart,
        endAt: recurrenceWindowEnd(windowStart, challenge.recurrence, timezone)
      }))[0];
    if (rewardTx && Number(rewardTx.points || 0) !== 0) {
      await reverseRewardTransaction(client, rewardTx, staff, reason, {
        category: "challenge_revoke",
        challenge_id: challenge.challenge_id
      });
    }
  }

  const remainingHistory = removeCompletionEntries(history, entriesToRevoke);
  const currentWindowStart = recurrenceWindowStart(referenceAt, challenge.recurrence, timezone);
  const currentWindowEnd = recurrenceWindowEnd(currentWindowStart, challenge.recurrence, timezone);
  const currentBounds = currentWindowStart && currentWindowEnd
    ? challengeBounds(challenge, currentWindowStart, currentWindowEnd)
    : null;
  const currentWindowEntry = currentBounds
    ? remainingHistory.find((entry) => completionWithinBounds(entry, { startAt: currentWindowStart, endAt: currentWindowEnd })) || null
    : null;
  const measuredValue = currentBounds
    ? await getChallengeMetricValue(client, customerId, challenge.requirement_type, currentBounds)
    : null;
  // Progress written in an earlier window no longer counts, and a refund can
  // only lower the current window's progress, never raise it.
  const writtenAt = challengeProgressWrittenAt(challenge);
  const storedProgress = currentBounds && (!writtenAt || hasRecurringWindowElapsed(writtenAt, challenge.recurrence, referenceAt, timezone))
    ? 0
    : Math.max(0, Number(challenge.progress || 0));
  const currentValue = measuredValue == null ? storedProgress : Math.min(storedProgress, measuredValue);
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

  return entriesToRevoke.length;
}

async function reconcileOneTimeChallenge(client, challenge, history, { customerId, staff, reason, refundedTransactionId }) {
  // Only settled purchases inside the challenge's own dates count, as when
  // progress was recorded. Earlier or later purchases neither keep a reward
  // that should be revoked nor add completions that were never paid.
  const windowValue = await getChallengeMetricValue(
    client,
    customerId,
    challenge.requirement_type,
    challengeBounds(challenge)
  );
  if (windowValue == null) return 0;

  const storedProgress = Math.max(0, Number(challenge.progress || 0));
  const currentValue = Math.min(storedProgress, windowValue);
  const expectedTimesCompleted = expectedNonRecurringChallengeCompletions(
    currentValue,
    challenge.requirement_value,
    challenge.max_completions
  );
  const actualTimesCompleted = Math.max(0, Number(challenge.times_completed || 0));
  const excessCompletions = Math.max(0, actualTimesCompleted - expectedTimesCompleted);
  // Never raise completions here: a completion counts only with its reward.
  const nextTimesCompleted = actualTimesCompleted - excessCompletions;
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
      nextTimesCompleted > 0,
      nextTimesCompleted > 0 ? (lastEntry?.completed_at || challenge.completed_at) : null,
      nextTimesCompleted,
      lastEntry?.source_transaction_id || null,
      lastEntry?.reward_transaction_id || null,
      JSON.stringify(remainingHistory)
    ]
  );
  return excessCompletions;
}

async function reconcileChallenges(client, customerId, staff, reason, referenceAt, refundedTransactionId = null, timezone = undefined) {
  const challenges = await getCurrentChallengeRows(client, customerId);
  const context = { customerId, staff, reason, referenceAt, refundedTransactionId, timezone };
  let revokedCount = 0;

  for (const challenge of challenges) {
    const history = normalizeCompletionHistory(challenge.completion_history);
    revokedCount += challenge.recurrence
      ? await reconcileRecurringChallenge(client, challenge, history, context)
      : await reconcileOneTimeChallenge(client, challenge, history, context);
  }

  return revokedCount;
}

// A referral reward is conditional on the referred customer's purchase. When
// that purchase is refunded and the remaining settled purchases no longer meet
// the requirement that applied, both rewards are reversed and the referral
// returns to pending, so a later genuine purchase can complete it again.
// Returns the referrer whose completed referral was withdrawn, if any.
async function reconcileReferralAfterRefund(client, { customerId, staff, reason, refundedTransactionId }) {
  const unchanged = { reversed: 0, referrerCustomerId: null, allowNegative: false };
  if (!refundedTransactionId) return unchanged;
  const { rows: referralRows } = await client.query(
    `SELECT r.*, s.min_purchase_to_complete AS current_min_purchase,
            s.reward_on_signup AS current_reward_on_signup, b.program_json
     FROM referrals r
     JOIN businesses b ON b.id = r.business_id
     JOIN transactions refunded ON refunded.id = $2
       AND refunded.customer_id = r.referred_customer_id
       AND refunded.source IN ('online', 'offline', 'external', 'order')
       AND (refunded.type = 'PURCHASE' OR refunded.type IS NULL)
       AND refunded.original_transaction_id IS NULL
       AND refunded.created_at <= COALESCE(r.completed_at, refunded.created_at)
     LEFT JOIN referral_settings s ON s.business_id = r.business_id
     WHERE r.referred_customer_id = $1
       AND r.status IN ('completed', 'rewarded')
     FOR UPDATE OF r`,
    [customerId, refundedTransactionId]
  );
  const referral = referralRows[0];
  if (!referral) return unchanged;

  const { rows: rewards } = await client.query(
    `SELECT t.*
     FROM transactions t
     WHERE t.business_id = $1
       AND t.type = 'REFERRAL_REWARD'
       AND t.meta->>'referral_id' = $2
       AND t.status IN ('POSTED', 'EXPIRED')
       AND t.reversed_transaction_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.original_transaction_id = t.id)
     ORDER BY t.created_at, t.id
     FOR UPDATE`,
    [referral.business_id, String(referral.id)]
  );
  if (!rewards.length) return unchanged;

  const rewardMeta = rewards.find((tx) => tx.meta?.trigger)?.meta || {};
  const trigger = rewardMeta.trigger || (referral.current_reward_on_signup ? "signup" : "purchase");
  if (trigger === "signup") return unchanged;
  const minPurchase = Object.hasOwn(rewardMeta, "min_purchase_to_complete")
    ? rewardMeta.min_purchase_to_complete
    : referral.current_min_purchase;
  const remaining = await getSettledPurchaseSummary(client.query.bind(client), customerId);
  if (referralPurchaseRequirementMet(remaining, minPurchase)) return unchanged;

  // An expired side cannot be reversed. Withdrawing the referral anyway would
  // reverse only the other side and reopen the referral, so a later purchase
  // would pay the expired side a second time. Keep the referral as it is.
  if (rewards.some((tx) => tx.status === "EXPIRED" || tx.expired_at)) {
    logger.warn({ referralId: referral.id, businessId: referral.business_id }, "Referral reward kept: a side of the reward has already expired");
    return unchanged;
  }

  // Do not push the referrer below zero against the business's refund policy.
  // Leave the referral untouched instead of reversing only one side.
  const allowNegative = referral.program_json?.balance_policy?.allow_negative_balance_on_refund === true;
  if (!allowNegative) {
    for (const tx of rewards.filter((reward) => reward.customer_id !== customerId)) {
      const { rows } = await client.query(
        `SELECT points FROM customer_balances WHERE customer_id = $1 FOR UPDATE`,
        [tx.customer_id]
      );
      if (Number(rows[0]?.points ?? 0) < Number(tx.points || 0)) {
        logger.warn({ referralId: referral.id, businessId: referral.business_id }, "Referral reward kept: referrer balance cannot cover the reversal");
        return unchanged;
      }
    }
  }

  let reversed = 0;
  for (const tx of rewards) {
    if (Number(tx.points || 0) === 0) continue;
    await reverseRewardTransaction(client, tx, staff, reason, {
      category: "referral_revoke",
      referral_id: referral.id,
      referral_side: tx.meta?.type || null
    });
    reversed += 1;
  }
  await client.query(
    `UPDATE referrals
     SET status = 'pending',
         completed_at = NULL,
         referrer_reward_points = NULL,
         referred_reward_points = NULL,
         referrer_rewarded_at = NULL,
         referred_rewarded_at = NULL
     WHERE id = $1`,
    [referral.id]
  );
  return { reversed, referrerCustomerId: referral.referrer_customer_id, allowNegative };
}

// The withdrawn referral and its reversed reward can leave the referrer short
// of milestones such as a referrals achievement. Re-measuring is idempotent.
// Under a no-negative refund policy the referrer keeps those achievements when
// their balance cannot cover the reversal, as for the referral reward itself.
async function reconcileReferrerAchievements(client, { referrerCustomerId, allowNegative, staff, reason, referenceAt }) {
  await lockCustomerGamification(client.query.bind(client), referrerCustomerId);
  await client.query("SAVEPOINT referrer_achievements");
  const revoked = await reconcileAchievements(client, referrerCustomerId, staff, reason, referenceAt, null);
  if (revoked && !allowNegative) {
    const { rows } = await client.query(`SELECT points FROM customer_balances WHERE customer_id = $1`, [referrerCustomerId]);
    if (Number(rows[0]?.points ?? 0) < 0) {
      await client.query("ROLLBACK TO SAVEPOINT referrer_achievements");
      await client.query("RELEASE SAVEPOINT referrer_achievements");
      logger.warn({ customerId: referrerCustomerId }, "Referrer achievements kept: balance cannot cover the reversal");
      return 0;
    }
  }
  await client.query("RELEASE SAVEPOINT referrer_achievements");
  return revoked;
}

async function customerTimezone(client, customerId) {
  const { rows } = await client.query(
    `SELECT b.program_json
     FROM customers c
     JOIN businesses b ON b.id = c.business_id
     WHERE c.id = $1`,
    [customerId]
  );
  return challengeTimezone(rows[0] || {});
}

export async function reconcileCustomerGamificationAfterRefund(client, {
  customerId,
  staff,
  reason,
  referenceAt = new Date(),
  refundedTransactionId = null
}) {
  // Referral rewards first: reversing them changes lifetime points.
  const referral = await reconcileReferralAfterRefund(client, { customerId, staff, reason, refundedTransactionId });
  const achievementsRevoked = await reconcileAchievements(client, customerId, staff, reason, referenceAt, refundedTransactionId);
  const timezone = await customerTimezone(client, customerId);
  const challengesRevoked = await reconcileChallenges(client, customerId, staff, reason, referenceAt, refundedTransactionId, timezone);
  const referrerAchievementsRevoked = referral.referrerCustomerId && String(referral.referrerCustomerId) !== String(customerId)
    ? await reconcileReferrerAchievements(client, { ...referral, staff, reason, referenceAt })
    : 0;

  return {
    achievementsRevoked,
    challengesRevoked,
    referralRewardsReversed: referral.reversed,
    referrerAchievementsRevoked
  };
}
