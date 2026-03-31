import crypto from "node:crypto";

import { GamificationRepository } from "../../repositories/gamification-repository.js";
import { withTransaction } from "../../database.js";
import { DEFAULT_ACHIEVEMENTS } from "./default-achievements.js";
import { getCustomerGamificationStats } from "./customer-stats.js";

function id() {
  return crypto.randomUUID();
}

async function sourceTransactionIsActive(sourceTransactionId, query) {
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

export function achievementProgressValue(stats, requirementType) {
  switch (requirementType) {
    case "points":
      return Number(stats.points || 0);
    case "spend":
      return Number(stats.total_spend || 0);
    case "visits":
      return Number(stats.total_visits || 0);
    case "items":
      return Number(stats.total_items || 0);
    case "referrals":
      return Number(stats.referral_count || 0);
    case "streak":
      return Number(stats.current_streak || 0);
    default:
      return 0;
  }
}

async function awardAchievementPoints(client, stats, customerId, achievement, context = {}) {
  if (achievement.points_reward <= 0) return;
  const rewardTransactionId = id();
  await client.query(
    `UPDATE customer_balances
     SET points = points + $1,
         lifetime_points = lifetime_points + GREATEST($1, 0),
         updated_at = now()
     WHERE customer_id = $2`,
    [achievement.points_reward, customerId]
  );
  await client.query(
    `INSERT INTO transactions
     (id, business_id, customer_id, type, points, meta)
     VALUES ($1, $2, $3, 'ACHIEVEMENT', $4, $5)`,
    [
      rewardTransactionId,
      stats.business_id,
      customerId,
      achievement.points_reward,
      JSON.stringify({
        achievement_id: achievement.id,
        achievement_name: achievement.name,
        source_transaction_id: context.sourceTransactionId || null
      })
    ]
  );
  return rewardTransactionId;
}

export async function createDefaultAchievements(businessId) {
  const achievements = [];
  for (const achievementData of DEFAULT_ACHIEVEMENTS) {
    const achievement = await GamificationRepository.createAchievement({
      business_id: businessId,
      ...achievementData
    });
    achievements.push(achievement);
  }
  return achievements;
}

export async function checkAndAwardAchievements(customerId, _eventType = null, context = {}) {
  return withTransaction(async (client) => {
    const q = client.query.bind(client);
    if (!await sourceTransactionIsActive(context.sourceTransactionId || null, q)) {
      return [];
    }
    const stats = await getCustomerGamificationStats(customerId, client.query.bind(client));
    const achievements = await GamificationRepository.listAchievements(stats.business_id);
    const newlyEarned = [];

    for (const achievement of achievements) {
      if (!achievement.active) continue;
      const alreadyEarned = await GamificationRepository.checkAchievementEarned(
        customerId,
        achievement.id,
        client.query.bind(client)
      );
      if (alreadyEarned) continue;

      const currentValue = achievementProgressValue(stats, achievement.requirement_type);
      if (currentValue < Number(achievement.requirement_value || 0)) continue;
      if (!await sourceTransactionIsActive(context.sourceTransactionId || null, q)) continue;

      const rewardTransactionId = await awardAchievementPoints(client, stats, customerId, achievement, context);
      await GamificationRepository.awardAchievement(
        customerId,
        achievement.id,
        100,
        {
          sourceTransactionId: context.sourceTransactionId || null,
          rewardTransactionId
        },
        q
      );
      newlyEarned.push(achievement);
    }

    return newlyEarned;
  });
}

export async function getCustomerAchievementsWithProgress(customerId) {
  const earned = await GamificationRepository.getCustomerAchievements(customerId);
  const stats = await getCustomerGamificationStats(customerId);
  const allAchievements = await GamificationRepository.listAchievements(stats.business_id);

  const inProgress = allAchievements
    .filter((achievement) => !earned.find((item) => item.achievement_id === achievement.id))
    .map((achievement) => {
      const current = achievementProgressValue(stats, achievement.requirement_type);
      const total = Number(achievement.requirement_value || 0);
      const progress = total > 0 ? Math.min(100, Math.floor((current / total) * 100)) : 0;
      return {
        ...achievement,
        progress,
        current,
        total,
        earned: false
      };
    });

  return {
    earned: earned.map((item) => ({ ...item, earned: true })),
    inProgress
  };
}
