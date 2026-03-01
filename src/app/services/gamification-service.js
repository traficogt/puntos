import {
  createDefaultAchievements,
  checkAndAwardAchievements,
  getCustomerAchievementsWithProgress
} from "./gamification/achievements-service.js";
import {
  createChallenge,
  getCustomerChallenges,
  updateChallengeProgress
} from "./gamification/challenges-service.js";
import {
  getPointsLeaderboard,
  getStreakLeaderboard,
  getCustomerPosition
} from "./gamification/leaderboards-service.js";

export const GamificationService = {
  createDefaultAchievements,
  checkAndAwardAchievements,
  getCustomerAchievementsWithProgress,
  createChallenge,
  getCustomerChallenges,
  updateChallengeProgress,
  getPointsLeaderboard,
  getStreakLeaderboard,
  getCustomerPosition
};
