import { Router } from "express";
import { z } from "zod";
import { requireOwner } from "../../../middleware/auth.js";
import { asyncRoute } from "../../../middleware/common.js";
import { getFirstPurchaseReturns } from "../../services/first-purchase-return-service.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */

export const analyticsFirstPurchaseReturnRoutes = Router();
export const FirstPurchaseReturnQuery = z
  .object({
    week_start: z.iso.date().optional(),
    branch_id: z
      .guid()
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .strict();

// The containing analytics router applies staff, tenant and plan gates first.
analyticsFirstPurchaseReturnRoutes.get(
  "/admin/analytics/first-purchase-returns",
  requireOwner,
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      const parsed = FirstPurchaseReturnQuery.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Selecciona una semana con fecha YYYY-MM-DD y una sucursal válida.",
          code: "VALIDATION_ERROR",
        });
      }
      return res.json(
        await getFirstPurchaseReturns({
          businessId: req.tenantId,
          branchId: parsed.data.branch_id ?? null,
          weekStart: parsed.data.week_start,
        }),
      );
    },
  ),
);
