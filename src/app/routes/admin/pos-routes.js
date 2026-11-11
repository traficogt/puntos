import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import * as PosIntegrationService from "../../services/pos-integration-service.js";
import * as PosRefundService from "../../services/pos-refund-service.js";

export function createAdminPosRoutes(deps = {}) {
  const router = Router();
  const service = { ...PosIntegrationService, ...PosRefundService, ...deps };
  const guards = [
    deps.requireStaff ?? requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("external_awards")
  ];

  router.get("/admin/pos", ...guards, asyncRoute(async (req, res) => {
    return res.json(await service.getPosIntegration(req.tenantId));
  }));

  router.put("/admin/pos", ...guards, csrfProtect, asyncRoute(async (req, res) => {
    return res.json(await service.configurePosIntegration(req.tenantId, req.body));
  }));

  router.post("/admin/pos/key", ...guards, csrfProtect, asyncRoute(async (req, res) => {
    return res.json(await service.rotatePosKey(req.tenantId));
  }));

  router.post("/admin/pos/csv/preview", ...guards, csrfProtect, asyncRoute(async (req, res) => {
    return res.json(await service.previewCsv(req.tenantId, req.body));
  }));

  router.post("/admin/pos/csv/import", ...guards, csrfProtect, asyncRoute(async (req, res) => {
    return res.json(await service.importCsv(req.tenantId, req.body));
  }));

  router.post("/admin/pos/loyverse/preview", ...guards, csrfProtect, asyncRoute(async (req, res) => {
    return res.json(await service.previewLoyverse(req.tenantId));
  }));

  router.post("/admin/pos/loyverse/sync", ...guards, csrfProtect, asyncRoute(async (req, res) => {
    return res.json(await service.syncLoyverseBusiness(req.tenantId));
  }));

  router.get("/admin/pos/refunds", ...guards, asyncRoute(async (req, res) => {
    return res.json(await service.listPosRefunds(req.tenantId, req.query));
  }));

  router.post("/admin/pos/refunds/:id/retry", ...guards, csrfProtect, asyncRoute(async (req, res) => {
    return res.json(await service.reconcilePosRefund(req.tenantId, req.params.id, { staff: req.staff }));
  }));

  return router;
}

export const adminPosRoutes = createAdminPosRoutes();
