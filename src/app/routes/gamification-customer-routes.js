import { Router } from "express";
import { requireCustomer } from "../../middleware/auth.js";
import { asyncRoute } from "../../middleware/common.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { tenantContext } from "../../middleware/tenant.js";
import { GamificationService } from "../services/gamification-service.js";
import { loadGamificationRepository, normalizeLeaderboardType } from "./gamification-support.js";

export const gamificationCustomerRoutes = Router();

gamificationCustomerRoutes.get(
  "/customer/achievements",
  requireCustomer,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const achievements = await GamificationService.getCustomerAchievementsWithProgress(req.customerAuth.id);
    res.json({ ok: true, ...achievements });
  })
);

gamificationCustomerRoutes.get(
  "/customer/challenges",
  requireCustomer,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const challenges = await GamificationService.getCustomerChallenges(req.customerAuth.id, req.customerAuth.business_id);
    res.json({ ok: true, challenges });
  })
);

gamificationCustomerRoutes.get(
  "/customer/streak",
  requireCustomer,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const GamificationRepository = await loadGamificationRepository();
    const streak = await GamificationRepository.getCustomerStreak(req.customerAuth.id);
    res.json({ ok: true, streak: streak || { current_streak: 0, longest_streak: 0 } });
  })
);

gamificationCustomerRoutes.get(
  "/customer/leaderboard/:type",
  requireCustomer,
  tenantContext,
  requirePlanFeature("gamification"),
  asyncRoute(async (req, res) => {
    const leaderboardType = normalizeLeaderboardType(req.params.type);
    if (!leaderboardType) {
      return res.status(400).json({ error: "Invalid leaderboard type" });
    }

    const position = await GamificationService.getCustomerPosition(req.customerAuth.id, leaderboardType);
    res.json({ ok: true, position });
  })
);
