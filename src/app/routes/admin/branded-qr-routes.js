import { Router } from "express";
import { z } from "zod";
import { csrfProtect } from "../../../middleware/csrf.js";
import { config } from "../../../config/index.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { asyncRoute } from "../../../middleware/common.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { hasPlanFeature, normalizePlan } from "../../../utils/plan.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { PlanConfigService } from "../../services/plan-config-service.js";
import { AcquisitionService } from "../../services/acquisition-service.js";
import { brandedQrConfiguration, renderBrandedQr } from "../../services/branded-qr-service.js";

const RenderOptions = z.object({
  source_id: z.guid().optional(),
  foreground: z.string().optional(),
  logo_position: z.enum(["center", "header", "none"]).optional(),
  logo_data_url: z.string().max(180000).nullable().optional(),
}).strict();
const GetOptions = RenderOptions.omit({ logo_data_url: true }).extend({ download: z.literal("1").optional() }).strict();
function sendSvg(res, svg) {
  return res.type("image/svg+xml")
    .set("X-Content-Type-Options", "nosniff")
    .set("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'none'; sandbox")
    .send(svg);
}

/**
 * @param {{appOrigin?: string, getBusiness?: (id: string) => Promise<any>, getPlanFeatureOverrides?: () => Promise<any>, getSources?: (business: any, origin: string) => Promise<any>, getSource?: (businessId: string, sourceId: string) => Promise<any>, staffAuth?: import("express").RequestHandler}} [deps]
 */
export function createAdminBrandedQrRoutes({
  appOrigin = config.APP_ORIGIN,
  getBusiness = id => BusinessRepo.getById(id),
  getPlanFeatureOverrides = () => PlanConfigService.getPlanFeatureOverrides(),
  staffAuth = requireStaff,
  getSources = (business, origin) => AcquisitionService.listSources(business, origin),
  getSource = (businessId, sourceId) => AcquisitionService.getSource(businessId, sourceId),
} = {}) {
  const router = Router();
  const guards = [
    (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); },
    staffAuth, requireOwner, tenantContext,
  ];
  async function context(req, res) {
    if (!req.tenantId) { res.status(401).json({ error: "Contexto de negocio requerido", code: "BUSINESS_CONTEXT_REQUIRED" }); return null; }
    const business = await getBusiness(req.tenantId);
    if (!business || String(business.id) !== String(req.tenantId)) { res.status(404).json({ error: "Negocio no encontrado" }); return null; }
    const overrides = await getPlanFeatureOverrides();
    if (!["EMPRENDEDOR", "NEGOCIO", "EMPRESA"].includes(normalizePlan(business.plan)) || !hasPlanFeature(business.plan, "branded_qr", overrides)) {
      res.status(403).json({ error: "El QR con marca está disponible desde el plan Negocio.", code: "PLAN_FEATURE_LOCKED", feature: "branded_qr", plan: business.plan, suggested_plan: "NEGOCIO" });
      return null;
    }
    return business;
  }
  router.get("/admin/customer-enrollment/branded-qr", ...guards, asyncRoute(async (req, res) => {
    const business = await context(req, res);
    if (!business) return;
    if (Object.keys(req.query).length) return res.status(400).json({ error: "La configuración usa el negocio de tu sesión." });
    return res.json({ ...brandedQrConfiguration(business, appOrigin), sources: (await getSources(business, appOrigin)).sources });
  }));
  router.get("/admin/customer-enrollment/branded-qr.svg", ...guards, asyncRoute(async (req, res) => {
    const business = await context(req, res);
    if (!business) return;
    const parsed = GetOptions.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Revisa las opciones del QR: color, posición y descarga." });
    const { download, source_id, ...options } = parsed.data;
    const source = source_id ? await getSource(business.id, source_id) : null;
    if (source_id && (!source || String(source.business_id) !== String(business.id))) return res.status(404).json({ error: "Origen no encontrado en este negocio." });
    const svg = renderBrandedQr(business, appOrigin, options, source);
    if (download === "1") res.set("Content-Disposition", 'attachment; filename="qr-registro-con-marca.svg"');
    return sendSvg(res, svg);
  }));
  router.post("/admin/customer-enrollment/branded-qr.svg", ...guards, csrfProtect, asyncRoute(async (req, res) => {
    const business = await context(req, res);
    if (!business) return;
    const parsed = RenderOptions.safeParse(req.body);
    if (!req.is("application/json") || Object.keys(req.query).length || !parsed.success) {
      return res.status(400).json({ error: "Revisa el color, la posición y la imagen del logotipo." });
    }
    // Export-only options: no business settings are changed and no logo URLs are fetched.
    const { source_id, ...options } = parsed.data;
    const source = source_id ? await getSource(business.id, source_id) : null;
    if (source_id && (!source || String(source.business_id) !== String(business.id))) return res.status(404).json({ error: "Origen no encontrado en este negocio." });
    return sendSvg(res, renderBrandedQr(business, appOrigin, options, source));
  }));
  return router;
}

export const adminBrandedQrRoutes = createAdminBrandedQrRoutes();
