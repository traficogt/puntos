import { Router } from "express";
import { z } from "zod";
import { GamificationService } from "../services/gamification-service.js";
import { requireStaff, requireOwner, requireCustomer } from "../../middleware/auth.js";
import { asyncRoute } from "../../middleware/common.js";
import { validateQuery } from "../../utils/schemas.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { validate } from "../../utils/validation.js";
import { tenantContext } from "../../middleware/tenant.js";

const router = Router();

const AchievementCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  icon_url: z.string().max(300).optional(),
  badge_image_url: z.string().max(300).optional(),
  requirement_type: z.enum(["visits", "spend", "points", "referrals", "streak"]),
  requirement_value: z.number().int().min(1).max(1000000),
  requirement_config: z.record(z.any()).optional(),
  points_reward: z.number().int().min(0).max(1000000).optional(),
  tier_boost: z.number().min(0).max(10).optional(),
  active: z.boolean().optional()
});

const AchievementUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  icon_url: z.string().max(300).optional(),
  badge_image_url: z.string().max(300).optional(),
  requirement_value: z.number().int().min(1).max(1000000).optional(),
  points_reward: z.number().int().min(0).max(1000000).optional(),
  active: z.boolean().optional()
});

const ChallengeCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  challenge_type: z.enum(["limited_time", "recurring", "milestone"]),
  requirement_type: z.enum(["visits", "spend", "points", "referrals", "streak"]),
  requirement_value: z.number().int().min(1).max(1000000),
  reward_points: z.number().int().min(0).max(1000000),
  start_date: z.string().datetime(),
  end_date: z.string().datetime().optional().nullable(),
  recurrence: z.string().max(60).optional().nullable(),
  max_completions: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional()
});

const ChallengeUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  reward_points: z.number().int().min(0).max(1000000).optional(),
  end_date: z.string().datetime().nullable().optional(),
  active: z.boolean().optional()
});

async function loadGamificationRepository() {
  const mod = await import("../repositories/gamification-repository.js");
  return mod.GamificationRepository;
}

router.get(
  "/customer/achievements",
  requireCustomer,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const customerId = req.customerAuth.id;
    const achievements = await GamificationService.getCustomerAchievementsWithProgress(customerId);
    res.json({ ok: true, ...achievements });
  })
);

router.get(
  "/customer/challenges",
  requireCustomer,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const customerId = req.customerAuth.id;
    const businessId = req.customerAuth.business_id;
    const challenges = await GamificationService.getCustomerChallenges(customerId, businessId);
    res.json({ ok: true, challenges });
  })
);

router.get(
  "/customer/streak",
  requireCustomer,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const customerId = req.customerAuth.id;
    const GamificationRepository = await loadGamificationRepository();
    const streak = await GamificationRepository.getCustomerStreak(customerId);
    res.json({ ok: true, streak: streak || { current_streak: 0, longest_streak: 0 } });
  })
);

router.get(
  "/customer/leaderboard/:type",
  requireCustomer,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const customerId = req.customerAuth.id;
    const leaderboardType = Array.isArray(req.params.type) ? req.params.type[0] : String(req.params.type || "");
    
    if (!['points', 'streak'].includes(leaderboardType)) {
      return res.status(400).json({ error: "Invalid leaderboard type" });
    }

    const position = await GamificationService.getCustomerPosition(customerId, leaderboardType);
    res.json({ ok: true, position });
  })
);

router.get(
  "/admin/achievements",
  requireStaff,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const GamificationRepository = await loadGamificationRepository();
    const achievements = await GamificationRepository.listAchievements(req.tenantId);
    res.json({ ok: true, achievements });
  })
);

router.post(
  "/admin/achievements",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const v = validate(AchievementCreateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const achievementData = {
      business_id: req.tenantId,
      name: v.data.name,
      description: v.data.description,
      icon_url: v.data.icon_url,
      badge_image_url: v.data.badge_image_url,
      requirement_type: v.data.requirement_type,
      requirement_value: v.data.requirement_value,
      requirement_config: v.data.requirement_config,
      points_reward: v.data.points_reward,
      tier_boost: v.data.tier_boost,
      active: v.data.active !== false
    };

    const GamificationRepository = await loadGamificationRepository();
    const achievement = await GamificationRepository.createAchievement(achievementData);
    res.status(201).json({ ok: true, achievement });
  })
);

router.put(
  "/admin/achievements/:id",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const v = validate(AchievementUpdateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const updates = {};
    for (const key of ["name", "description", "icon_url", "badge_image_url", "requirement_value", "points_reward", "active"]) {
      if (v.data[key] !== undefined) updates[key] = v.data[key];
    }

    const GamificationRepository = await loadGamificationRepository();
    const achievement = await GamificationRepository.updateAchievementScoped(req.params.id, req.tenantId, updates);
    res.json({ ok: true, achievement });
  })
);

router.delete(
  "/admin/achievements/:id",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const GamificationRepository = await loadGamificationRepository();
    const deleted = await GamificationRepository.deleteAchievementScoped(req.params.id, req.tenantId);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  })
);

router.get(
  "/admin/challenges",
  requireStaff,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const GamificationRepository = await loadGamificationRepository();
    const challenges = await GamificationRepository.listActiveChallenges(req.tenantId);
    res.json({ ok: true, challenges });
  })
);

router.post(
  "/admin/challenges",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const v = validate(ChallengeCreateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const challengeData = {
      business_id: req.tenantId,
      name: v.data.name,
      description: v.data.description,
      challenge_type: v.data.challenge_type,
      requirement_type: v.data.requirement_type,
      requirement_value: v.data.requirement_value,
      reward_points: v.data.reward_points,
      start_date: v.data.start_date,
      end_date: v.data.end_date,
      recurrence: v.data.recurrence,
      max_completions: v.data.max_completions,
      active: v.data.active !== false
    };

    const challenge = await GamificationService.createChallenge(req.tenantId, challengeData);
    res.status(201).json({ ok: true, challenge });
  })
);

router.put(
  "/admin/challenges/:id",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const v = validate(ChallengeUpdateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const updates = {};
    for (const key of ["name", "description", "reward_points", "end_date", "active"]) {
      if (v.data[key] !== undefined) updates[key] = v.data[key];
    }

    const GamificationRepository = await loadGamificationRepository();
    const challenge = await GamificationRepository.updateChallengeScoped(req.params.id, req.tenantId, updates);
    if (!challenge) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, challenge });
  })
);

router.delete(
  "/admin/challenges/:id",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const GamificationRepository = await loadGamificationRepository();
    const deleted = await GamificationRepository.deleteChallengeScoped(req.params.id, req.tenantId);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  })
);

router.get(
  "/admin/leaderboard/:type",
  requireStaff,
  tenantContext,
  requirePlanFeature("gamification"),
  validateQuery(z.object({
    timeframe: z.preprocess(
      (v) => (Array.isArray(v) ? v[0] : v),
      z.enum(["week", "month", "all_time"]).default("all_time")
    ),
    limit: z.preprocess(
      (v) => (Array.isArray(v) ? v[0] : v),
      z.coerce.number().int().min(1).max(100).default(10)
    )
  })),
  asyncRoute(async (req, res) => {
    const leaderboardType = Array.isArray(req.params.type) ? req.params.type[0] : String(req.params.type || "");
    const { timeframe, limit } = req.validatedQuery;

    if (!['points', 'streak'].includes(leaderboardType)) {
      return res.status(400).json({ error: "Invalid leaderboard type" });
    }

    let leaderboard;
    if (leaderboardType === 'points') {
      leaderboard = await GamificationService.getPointsLeaderboard(
        req.tenantId,
        limit,
        timeframe
      );
    } else {
      leaderboard = await GamificationService.getStreakLeaderboard(
        req.tenantId,
        limit
      );
    }

    res.json({ ok: true, leaderboard });
  })
);

export default router;
