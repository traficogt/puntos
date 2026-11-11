import { Router } from "express";
import QRCode from "qrcode";

import { config } from "../../../config/index.js";
import { asyncRoute } from "../../../middleware/common.js";
import { requireStaff, requireStaffPermission } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { Permission } from "../../../utils/permissions.js";
import { businessCustomerBrandingSchema } from "../../../utils/schemas.js";
import { validate } from "../../../utils/validation.js";
import { BusinessRepo } from "../../repositories/business-repository.js";

/** @typedef {import("../../../types/http-dto.js").AdminBrandingResponse} AdminBrandingResponse */

/**
 * @param {{appOrigin?: string, getBusiness?: (id: string) => Promise<any>, staffAuth?: import("express").RequestHandler}} [deps]
 */
export function createAdminBrandingRoutes({ appOrigin = config.APP_ORIGIN, getBusiness = id => BusinessRepo.getById(id), staffAuth = requireStaff } = {}) {
  const adminBrandingRoutes = Router();
  const registrationUrl = business => `${new URL(appOrigin).origin}/registro/${encodeURIComponent(business.slug)}`;
  const enrollmentGuards = [staffAuth, requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC), tenantContext];

  adminBrandingRoutes.get("/admin/customer-enrollment", ...enrollmentGuards, asyncRoute(async (req, res) => {
    const business = await getBusiness(req.tenantId);
    res.set("Cache-Control", "private, no-store");
    if (!business) return res.status(404).json({ error: "Business not found" });
    return res.json({
      ok: true,
      business: { id: business.id, name: business.name, slug: business.slug },
      registration_url: registrationUrl(business)
    });
  }));

  adminBrandingRoutes.get("/admin/customer-enrollment/qr.svg", ...enrollmentGuards, asyncRoute(async (req, res) => {
    const business = await getBusiness(req.tenantId);
    res.set("Cache-Control", "private, no-store");
    if (!business) return res.status(404).json({ error: "Business not found" });
    const svg = await QRCode.toString(registrationUrl(business), {
      type: "svg", errorCorrectionLevel: "M", margin: 4, width: 240,
      color: { dark: "#000000", light: "#ffffff" }
    });
    if (req.query.download === "1") res.set("Content-Disposition", 'attachment; filename="qr-registro.svg"');
    return res.type("image/svg+xml").set("X-Content-Type-Options", "nosniff").send(svg);
  }));

  adminBrandingRoutes.get(
    "/admin/branding",
    staffAuth,
    requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC),
    tenantContext,
    asyncRoute(async (req, res) => {
      const business = await getBusiness(req.tenantId);
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
    staffAuth,
    requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC),
    tenantContext,
    asyncRoute(async (req, res) => {
      const business = await getBusiness(req.tenantId);
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
  return adminBrandingRoutes;
}

export const adminBrandingRoutes = createAdminBrandingRoutes();
