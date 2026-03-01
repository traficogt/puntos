import { GamificationRepository } from "../../repositories/gamification-repository.js";
import { withTransaction } from "../../database.js";
import { DEFAULT_ACHIEVEMENTS } from "./default-achievements.js";
import { getCustomerGamificationStats } from "./customer-stats.js";

function achievementProgressValue(stats, requirementType) {
  switch (requirementType) {
    case "points":
      return Number(stats.points || 0);
    case "spend":
      return Number(stats.total_spend || 0);
    case "visits":
      return Number(stats.total_visits || 0);
    case "referrals":
      return Number(stats.referral_count || 0);
    case "streak":
      return Number(stats.current_streak || 0);
    default:
      return 0;
  }
}

async function awardAchievementPoints(client, stats, customerId, achievement) {
  if (achievement.points_reward <= 0) return;
  await client.query(
    `UPDATE customer_balances
     SET points = points + $1, updated_at = now()
     WHERE customer_id = $2`,
    [achievement.points_reward, customerId]
  );
  await client.query(
    `INSERT INTO transactions
     (business_id, customer_id, type, points, meta)
     VALUES ($1, $2, 'ACHIEVEMENT', $3, $4)`,
    [
      stats.business_id,
      customerId,
      achievement.points_reward,
      JSON.stringify({
        achievement_id: achievement.id,
        achievement_name: achievement.name
      })
    ]
  );
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

export async function checkAndAwardAchievements(customerId, _eventType = null) {
  return withTransaction(async (client) => {
    const stats = await getCustomerGamificationStats(customerId, client.query.bind(client));
    const achievements = await GamificationRepository.listAchievements(stats.business_id);
    const newlyEarned = [];

    for (const achievement of achievements) {
      if (!achievement.active) continue;
      const alreadyEarned = await GamificationRepository.checkAchievementEarned(customerId, achievement.id);
      if (alreadyEarned) continue;

      const currentValue = achievementProgressValue(stats, achievement.requirement_type);
      if (currentValue < Number(achievement.requirement_value || 0)) continue;

      await GamificationRepository.awardAchievement(customerId, achievement.id);
      await awardAchievementPoints(client, stats, customerId, achievement);
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
