import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner, requireSuperAdmin } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import {
  getDataHealth,
  saveDataHealth,
  healthSettingsSchema,
} from "../services/data-health-service.js";
import { getPlatformOperationsHealth } from "../services/platform-health-service.js";
import { validationErrorBody } from "../../utils/schemas.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/** @typedef {z.infer<typeof page>} OperationsHealthQuery */
/** @typedef {z.infer<typeof healthSettingsSchema>} HealthSettingsInput */

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   getDataHealth: (input: { businessId: string }) => Promise<unknown>,
 *   saveDataHealth: (input: {
 *     businessId: string,
 *     staffId: string,
 *     impersonated_by: string | null,
 *     input: HealthSettingsInput
 *   }) => Promise<unknown>,
 *   getPlatformOperationsHealth: (input: OperationsHealthQuery) => Promise<unknown>
 * }} DataHealthDeps
 */

const empty = z.object({}).strict();
const page = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
/** @param {Request} _req @param {Response} res @param {NextFunction} next */
const noStore = (_req, res, next) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  next();
};
/** @param {Response} res */
const invalid = (res) =>
  res.status(400).json({ error: "Revisa los datos enviados.", code: "VALIDATION_ERROR" });
/** @param {Partial<DataHealthDeps>} [injected] */
export function createDataHealthRoutes(injected = {}) {
  /** @type {DataHealthDeps} */
  const s = { getDataHealth, saveDataHealth, getPlatformOperationsHealth, ...injected },
    router = Router();
  router.get(
    "/admin/data-health",
    noStore,
    requireStaff,
    requireOwner,
    tenantContext,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success || !empty.safeParse(req.body ?? {}).success)
          return invalid(res);
        return res.json(await s.getDataHealth({ businessId: req.tenantId }));
      },
    ),
  );
  router.put(
    "/admin/data-health",
    noStore,
    requireStaff,
    requireOwner,
    tenantContext,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        const input = healthSettingsSchema.safeParse(req.body);
        if (!input.success) return res.status(400).json(validationErrorBody(input.error));
        return res.json(
          await s.saveDataHealth({
            businessId: req.tenantId,
            staffId: req.staff.id,
            impersonated_by: req.staff.impersonated_by ?? null,
            input: input.data,
          }),
        );
      },
    ),
  );
  router.get(
    "/super/operations-health",
    noStore,
    requireSuperAdmin,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const input = page.safeParse(req.query);
        if (!input.success || !empty.safeParse(req.body ?? {}).success) return invalid(res);
        return res.json(await s.getPlatformOperationsHealth(input.data));
      },
    ),
  );
  return router;
}
export const dataHealthRoutes = createDataHealthRoutes();
