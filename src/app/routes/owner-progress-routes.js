import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import { validateRequest } from "../../utils/schemas.js";
import {
  OwnerProgressAcknowledgeSchema,
  OwnerProgressGoalSchema,
  OwnerProgressReviewSchema,
  OwnerProgressVisibilitySchema,
  acknowledgeOwnerProgressMilestones,
  getOwnerProgress,
  loadOwnerProgressSettings,
  recordOwnerProgressReview,
  setOwnerProgressGoal,
  setOwnerProgressVisibility,
} from "../services/owner-progress-service.js";

const Empty = z.object({}).strict();
const defaultService = {
  getOwnerProgress,
  acknowledgeOwnerProgressMilestones,
  setOwnerProgressGoal,
  recordOwnerProgressReview,
  setOwnerProgressVisibility,
};

/**
 * "Tu progreso" for owners: every plan, owner role only, no plan-feature gate. The
 * platform setting owner_progress_mode = off hides the whole API (404).
 * @param {{staffAuth?: import("express").RequestHandler, service?: Partial<typeof defaultService>, getSettings?: () => Promise<{mode: string, holdout_pct: number}>}} [deps]
 */
export function createOwnerProgressRoutes({
  staffAuth = requireStaff,
  service = {},
  getSettings = () => loadOwnerProgressSettings(),
} = {}) {
  const router = Router(),
    s = { ...defaultService, ...service },
    base = "/admin/owner-progress";
  router.use(
    base,
    (_req, res, next) => {
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      next();
    },
    staffAuth,
    requireOwner,
    tenantContext,
  );
  const unavailable = (res) =>
    res.status(404).json({ error: "Tu progreso no está disponible.", code: "NOT_FOUND" });
  const invalid = (res) =>
    res
      .status(400)
      .json({ error: "Esta consulta no acepta parámetros.", code: "VALIDATION_ERROR" });
  const actor = (req) => ({
    businessId: req.tenantId,
    staffId: req.staff.id,
    ip: req.ip,
    ua: req.get("user-agent") || null,
  });
  router.get(
    base,
    asyncRoute(async (req, res) => {
      if (!Empty.safeParse(req.query).success || Number(req.get("Content-Length") || 0) > 0)
        return invalid(res);
      const settings = await getSettings();
      if (settings.mode === "off") return unavailable(res);
      return res.json(await s.getOwnerProgress({ businessId: req.tenantId, settings }));
    }),
  );
  const actions = [
    {
      suffix: "acknowledge",
      schema: OwnerProgressAcknowledgeSchema,
      run: (input) => s.acknowledgeOwnerProgressMilestones({ ...input, keys: input.body.keys }),
    },
    {
      suffix: "goal",
      schema: OwnerProgressGoalSchema,
      run: (input) =>
        s.setOwnerProgressGoal({ ...input, key: input.body.key, dismiss: input.body.dismiss }),
    },
    {
      suffix: "review",
      schema: OwnerProgressReviewSchema,
      run: (input) =>
        s.recordOwnerProgressReview({
          ...input,
          decision: input.body.decision,
          note: input.body.note,
        }),
    },
    {
      suffix: "visibility",
      schema: OwnerProgressVisibilitySchema,
      run: (input) => s.setOwnerProgressVisibility({ ...input, hidden: input.body.hidden }),
    },
  ];
  for (const { suffix, schema, run } of actions)
    router.post(
      `${base}/${suffix}`,
      csrfProtect,
      validateRequest(schema),
      asyncRoute(async (req, res) => {
        if (!Empty.safeParse(req.query).success) return invalid(res);
        const settings = await getSettings();
        if (settings.mode === "off") return unavailable(res);
        return res.json(await run({ ...actor(req), settings, body: req.validated }));
      }),
    );
  return router;
}
export const ownerProgressRoutes = createOwnerProgressRoutes();
