import { Router } from "express";
import { logger } from "../../utils/logger.js";
import { asyncRoute } from "../../middleware/common.js";
import { requireSuperAdmin } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { PlatformSettingsRepo } from "../repositories/platform-settings-repository.js";
import {
  OwnerProgressSettingsSchema,
  resolveOwnerProgressSettings,
} from "../services/owner-progress-service.js";

// Platform-owner-only "Tu progreso" controls (docs/product/2026-11-23-owner-progress.md):
// mode off | checklist | full and the holdout share used for the deterministic
// per-business variant. Variants already assigned to a business are never reassigned.
export const superOwnerProgressRoutes = Router();

superOwnerProgressRoutes.get(
  "/super/platform-settings/owner-progress",
  requireSuperAdmin,
  asyncRoute(async (_req, res) => {
    const settings = resolveOwnerProgressSettings(await PlatformSettingsRepo.getOwnerProgress());
    res.json({ ok: true, settings });
  }),
);

superOwnerProgressRoutes.put(
  "/super/platform-settings/owner-progress",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    const parsed = OwnerProgressSettingsSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Payload inválido", code: "VALIDATION_ERROR" });
    const settings = resolveOwnerProgressSettings(
      await PlatformSettingsRepo.setOwnerProgress(parsed.data),
    );
    // Platform-level change (no business): audit_logs requires a business, so record it
    // in the structured server log like the other platform-wide settings.
    logger.info(
      { action: "super.owner_progress.update", superAdminEmail: req.superAdmin.email, settings },
      "Owner progress platform settings updated",
    );
    res.json({ ok: true, settings });
  }),
);
