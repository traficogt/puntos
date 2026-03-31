import { Router } from "express";
import { requireOwner, requireStaff } from "../../middleware/auth.js";
import { asyncRoute } from "../../middleware/common.js";
import { validateQuery } from "../../utils/schemas.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { validate } from "../../utils/validation.js";
import { tenantContext } from "../../middleware/tenant.js";
import { GamificationService } from "../services/gamification-service.js";
import {
  AchievementCreateSchema,
  AchievementUpdateSchema,
  ChallengeCreateSchema,
  ChallengeUpdateSchema,
  LeaderboardQuerySchema,
  loadGamificationRepository,
  normalizeLeaderboardType
} from "./gamification-support.js";

export const gamificationAdminRoutes = Router();

gamificationAdminRoutes.get(
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

gamificationAdminRoutes.post(
  "/admin/achievements",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const v = validate(AchievementCreateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const GamificationRepository = await loadGamificationRepository();
    const achievement = await GamificationRepository.createAchievement({
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
    });
    res.status(201).json({ ok: true, achievement });
  })
);

gamificationAdminRoutes.put(
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

gamificationAdminRoutes.delete(
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

gamificationAdminRoutes.get(
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

gamificationAdminRoutes.post(
  "/admin/challenges",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const v = validate(ChallengeCreateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const challenge = await GamificationService.createChallenge(req.tenantId, {
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
    });
    res.status(201).json({ ok: true, challenge });
  })
);

gamificationAdminRoutes.put(
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

gamificationAdminRoutes.delete(
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

gamificationAdminRoutes.get(
  "/admin/leaderboard/:type",
  requireStaff,
  tenantContext,
  requirePlanFeature("gamification"),
  validateQuery(LeaderboardQuerySchema),
  asyncRoute(async (req, res) => {
    const leaderboardType = normalizeLeaderboardType(req.params.type);
    if (!leaderboardType) {
      return res.status(400).json({ error: "Invalid leaderboard type" });
    }

    const { timeframe, limit } = req.validatedQuery;
    const leaderboard = leaderboardType === "points"
      ? await GamificationService.getPointsLeaderboard(req.tenantId, limit, timeframe)
      : await GamificationService.getStreakLeaderboard(req.tenantId, limit);

    res.json({ ok: true, leaderboard });
  })
);
