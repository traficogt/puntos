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

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/**
 * @template Body
 * @typedef {import("./_request-types.js").WithValidated<Body>} WithValidated
 */
/** @typedef {{ mode: string, holdout_pct: number }} OwnerProgressSettings */
/** @typedef {z.infer<typeof OwnerProgressAcknowledgeSchema>} OwnerProgressAcknowledgeBody */
/** @typedef {z.infer<typeof OwnerProgressGoalSchema>} OwnerProgressGoalBody */
/** @typedef {z.infer<typeof OwnerProgressReviewSchema>} OwnerProgressReviewBody */
/** @typedef {z.infer<typeof OwnerProgressVisibilitySchema>} OwnerProgressVisibilityBody */
/**
 * What every action handler receives: the acting owner, the platform settings
 * and the body already validated by the action's schema.
 * @template Body
 * @typedef {{
 *   businessId: string,
 *   staffId: string,
 *   ip: string | undefined,
 *   ua: string | null,
 *   settings: OwnerProgressSettings,
 *   body: Body
 * }} OwnerProgressActionInput
 */
/**
 * One POST action. `run` is declared as a method so each entry may narrow its
 * body type while the table stays homogeneous (the schema guards it at runtime).
 * @typedef {{
 *   suffix: string,
 *   schema: z.ZodType,
 *   run(input: OwnerProgressActionInput<unknown>): Promise<unknown>
 * }} OwnerProgressAction
 */

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
 * @param {{staffAuth?: import("express").RequestHandler, service?: Partial<typeof defaultService>, getSettings?: () => Promise<OwnerProgressSettings>}} [deps]
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
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      next();
    },
    staffAuth,
    requireOwner,
    tenantContext,
  );
  /** @param {Response} res */
  const unavailable = (res) =>
    res.status(404).json({ error: "Tu progreso no está disponible.", code: "NOT_FOUND" });
  /** @param {Response} res */
  const invalid = (res) =>
    res
      .status(400)
      .json({ error: "Esta consulta no acepta parámetros.", code: "VALIDATION_ERROR" });
  /** @param {TenantRequest} req */
  const actor = (req) => ({
    businessId: req.tenantId,
    staffId: req.staff.id,
    ip: req.ip,
    ua: req.get("user-agent") || null,
  });
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!Empty.safeParse(req.query).success || Number(req.get("Content-Length") || 0) > 0)
          return invalid(res);
        const settings = await getSettings();
        if (settings.mode === "off") return unavailable(res);
        return res.json(await s.getOwnerProgress({ businessId: req.tenantId, settings }));
      },
    ),
  );
  /** @type {OwnerProgressAction[]} */
  const actions = [
    {
      suffix: "acknowledge",
      schema: OwnerProgressAcknowledgeSchema,
      /** @param {OwnerProgressActionInput<OwnerProgressAcknowledgeBody>} input */
      run: (input) => s.acknowledgeOwnerProgressMilestones({ ...input, keys: input.body.keys }),
    },
    {
      suffix: "goal",
      schema: OwnerProgressGoalSchema,
      /** @param {OwnerProgressActionInput<OwnerProgressGoalBody>} input */
      run: (input) =>
        s.setOwnerProgressGoal({ ...input, key: input.body.key, dismiss: input.body.dismiss }),
    },
    {
      suffix: "review",
      schema: OwnerProgressReviewSchema,
      /** @param {OwnerProgressActionInput<OwnerProgressReviewBody>} input */
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
      /** @param {OwnerProgressActionInput<OwnerProgressVisibilityBody>} input */
      run: (input) => s.setOwnerProgressVisibility({ ...input, hidden: input.body.hidden }),
    },
  ];
  for (const { suffix, schema, run } of actions)
    router.post(
      `${base}/${suffix}`,
      csrfProtect,
      validateRequest(schema),
      asyncRoute(
        /** @param {TenantRequest & WithValidated<unknown>} req @param {Response} res */
        async (req, res) => {
          if (!Empty.safeParse(req.query).success) return invalid(res);
          const settings = await getSettings();
          if (settings.mode === "off") return unavailable(res);
          return res.json(await run({ ...actor(req), settings, body: req.validated }));
        },
      ),
    );
  return router;
}
export const ownerProgressRoutes = createOwnerProgressRoutes();
