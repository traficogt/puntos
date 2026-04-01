import { z } from "zod";

export const AchievementCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  icon_url: z.string().max(300).optional(),
  badge_image_url: z.string().max(300).optional(),
  requirement_type: z.enum(["visits", "spend", "points", "items", "referrals", "streak"]),
  requirement_value: z.number().int().min(1).max(1000000),
  requirement_config: z.record(z.any()).optional(),
  points_reward: z.number().int().min(0).max(1000000).optional(),
  tier_boost: z.number().min(0).max(10).optional(),
  active: z.boolean().optional()
});

export const AchievementUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  icon_url: z.string().max(300).optional(),
  badge_image_url: z.string().max(300).optional(),
  requirement_value: z.number().int().min(1).max(1000000).optional(),
  points_reward: z.number().int().min(0).max(1000000).optional(),
  active: z.boolean().optional()
});

export const ChallengeCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  challenge_type: z.enum(["limited_time", "recurring", "milestone"]),
  requirement_type: z.enum(["visits", "spend", "points", "items", "referrals", "streak"]),
  requirement_value: z.number().int().min(1).max(1000000),
  reward_points: z.number().int().min(0).max(1000000),
  start_date: z.string().datetime(),
  end_date: z.string().datetime().optional().nullable(),
  recurrence: z.string().max(60).optional().nullable(),
  max_completions: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional()
});

export const ChallengeUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  reward_points: z.number().int().min(0).max(1000000).optional(),
  end_date: z.string().datetime().nullable().optional(),
  active: z.boolean().optional()
});

export const LeaderboardQuerySchema = z.object({
  timeframe: z.preprocess(
    (value) => (Array.isArray(value) ? value[0] : value),
    z.enum(["week", "month", "all_time"]).default("all_time")
  ),
  limit: z.preprocess(
    (value) => (Array.isArray(value) ? value[0] : value),
    z.coerce.number().int().min(1).max(100).default(10)
  )
});

export function normalizeLeaderboardType(rawType) {
  const leaderboardType = Array.isArray(rawType) ? rawType[0] : String(rawType || "");
  return ["points", "streak"].includes(leaderboardType) ? leaderboardType : null;
}

export async function loadGamificationRepository() {
  const mod = await import("../repositories/gamification-repository.js");
  return mod.GamificationRepository;
}
