import { Router } from "express";

import { asyncRoute } from "../../../middleware/common.js";
import { requireStaff, requireStaffPermission } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { Permission } from "../../../utils/permissions.js";
import { businessCustomerBrandingSchema } from "../../../utils/schemas.js";
import { validate } from "../../../utils/validation.js";
import { BusinessRepo } from "../../repositories/business-repository.js";

/** @typedef {import("../../../types/http-dto.js").AdminBrandingResponse} AdminBrandingResponse */

export const adminBrandingRoutes = Router();

adminBrandingRoutes.get(
  "/admin/branding",
  requireStaff,
  requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC),
  tenantContext,
  asyncRoute(async (req, res) => {
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    /** @type {AdminBrandingResponse} */
    const response = {
      ok: true,
      customer_branding: business.customer_branding_json ?? businessCustomerBrandingSchema.parse({})
    };
    return res.json(response);
  })
);

adminBrandingRoutes.put(
  "/admin/branding",
  requireStaff,
  requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC),
  tenantContext,
  asyncRoute(async (req, res) => {
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    const parsed = validate(businessCustomerBrandingSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    if (parsed.data.qr_logo_enabled === true && String(business.plan || "").toUpperCase() !== "EMPRESA") {
      return res.status(403).json({ error: "QR premium requiere plan EMPRESA" });
    }
    const updatedBusiness = await BusinessRepo.updateCustomerBranding(req.tenantId, parsed.data);
    /** @type {AdminBrandingResponse} */
    const response = {
      ok: true,
      customer_branding: updatedBusiness?.customer_branding_json ?? parsed.data
    };
    return res.json(response);
  })
);
