import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { validateRequest } from "../../../utils/schemas.js";
import * as PosIntegrationService from "../../services/pos-integration-service.js";
import * as PosRefundService from "../../services/pos-refund-service.js";

/** @typedef {import("../_request-types.js").Response} Response */
/**
 * @template [P=import("../_request-types.js").ParamsDictionary]
 * @typedef {import("../_request-types.js").TenantRequest<P>} TenantRequest
 */
/**
 * @template Body
 * @typedef {import("../_request-types.js").WithValidated<Body>} WithValidated
 */

// Envelope only: the CSV normalizer keeps its own column, source and unit checks
// (which depend on whether columns were supplied) and its owner-facing messages.
const posCsvShape = z.looseObject({
  csv: z.string(),
  columns: z.record(z.string(), z.unknown()).optional(),
});

/** @typedef {z.infer<typeof posCsvShape>} PosCsvBody */

/**
 * Overrides for tests: the staff guard and any POS integration/refund service function.
 * @typedef {{ requireStaff?: import("express").RequestHandler }
 *   & Partial<typeof PosIntegrationService & typeof PosRefundService>} AdminPosRoutesDeps
 */

/** @param {AdminPosRoutesDeps} [deps] */
export function createAdminPosRoutes(deps = {}) {
  const router = Router();
  const service = { ...PosIntegrationService, ...PosRefundService, ...deps };
  const guards = [
    deps.requireStaff ?? requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("external_awards"),
  ];

  router.get(
    "/admin/pos",
    ...guards,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        return res.json(await service.getPosIntegration(req.tenantId));
      },
    ),
  );

  router.put(
    "/admin/pos",
    ...guards,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        return res.json(await service.configurePosIntegration(req.tenantId, req.body));
      },
    ),
  );

  router.post(
    "/admin/pos/key",
    ...guards,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        return res.json(await service.rotatePosKey(req.tenantId));
      },
    ),
  );

  router.post(
    "/admin/pos/csv/preview",
    ...guards,
    csrfProtect,
    validateRequest(posCsvShape),
    asyncRoute(
      /** @param {TenantRequest & WithValidated<PosCsvBody>} req @param {Response} res */
      async (req, res) => {
        return res.json(await service.previewCsv(req.tenantId, req.validated));
      },
    ),
  );

  router.post(
    "/admin/pos/csv/import",
    ...guards,
    csrfProtect,
    validateRequest(posCsvShape),
    asyncRoute(
      /** @param {TenantRequest & WithValidated<PosCsvBody>} req @param {Response} res */
      async (req, res) => {
        return res.json(await service.importCsv(req.tenantId, req.validated));
      },
    ),
  );

  router.post(
    "/admin/pos/loyverse/preview",
    ...guards,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        return res.json(await service.previewLoyverse(req.tenantId));
      },
    ),
  );

  router.post(
    "/admin/pos/loyverse/sync",
    ...guards,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        return res.json(await service.syncLoyverseBusiness(req.tenantId));
      },
    ),
  );

  router.get(
    "/admin/pos/refunds",
    ...guards,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        return res.json(await service.listPosRefunds(req.tenantId, req.query));
      },
    ),
  );

  router.post(
    "/admin/pos/refunds/:id/retry",
    ...guards,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest<{ id: string }>} req @param {Response} res */
      async (req, res) => {
        return res.json(
          await service.reconcilePosRefund(req.tenantId, req.params.id, { staff: req.staff }),
        );
      },
    ),
  );

  return router;
}

export const adminPosRoutes = createAdminPosRoutes();
