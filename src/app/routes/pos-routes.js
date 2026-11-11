import {getPosCheckoutOptions,authorizePosCheckout,getPosCheckoutStatus,cancelPosCheckout} from '../services/pos-checkout-service.js';
import {syncMerchantCatalog,recordInventorySnapshot} from '../services/merchant-catalog-service.js';
import {lookupPosRedemption,recordPosFulfillmentEvent} from '../services/redemption-pos-event-service.js';
import {getPosRewardMappings} from '../services/reward-pos-mapping-service.js';
import { Router } from "express";
import { asyncRoute } from "../../middleware/common.js";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { setTenantForRequest } from "../../middleware/tenant.js";
import { hasPlanFeature, suggestedPlanForFeature } from "../../utils/plan.js";
import { notFound, unauthorized } from "../../utils/http-error.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { PlanConfigService } from "../services/plan-config-service.js";
import { verifyPosCredentials } from "../services/pos/common.js";
import { ingestPosSale } from "../services/pos-integration-service.js";
import { ingestPosRefund } from "../services/pos-refund-service.js";

export function createPosRoutes(deps = {}) {
  const router = Router();
  const businessRepo = deps.BusinessRepo ?? BusinessRepo;
  const plans = deps.PlanConfigService ?? PlanConfigService;
  const setTenant = deps.setTenantForRequest ?? setTenantForRequest;
  const handlers = { "catalog/sync": deps.syncMerchantCatalog ?? syncMerchantCatalog, "inventory/snapshot": deps.recordInventorySnapshot ?? recordInventorySnapshot, "checkout/options": deps.getPosCheckoutOptions ?? getPosCheckoutOptions, "checkout/authorize": deps.authorizePosCheckout ?? authorizePosCheckout, "checkout/status": deps.getPosCheckoutStatus ?? getPosCheckoutStatus, "checkout/cancel": deps.cancelPosCheckout ?? cancelPosCheckout, sales: deps.ingestPosSale ?? ingestPosSale, refunds: deps.ingestPosRefund ?? ingestPosRefund, "redemptions/lookup": deps.lookupPosRedemption ?? lookupPosRedemption, "redemptions/events": deps.recordPosFulfillmentEvent ?? recordPosFulfillmentEvent, "redemptions/mappings": deps.getPosRewardMappings ?? getPosRewardMappings };

  for (const [kind, ingest] of Object.entries(handlers)) router.post(`/public/pos/:slug/${kind}`, moderateRateLimit, asyncRoute(async (req, res) => {
    const publicBusiness = await businessRepo.getPublicBySlug(req.params.slug);
    if (!publicBusiness) throw notFound("Negocio no encontrado");

    await setTenant(req, publicBusiness.id);
    const business = await businessRepo.getById(publicBusiness.id);
    if (!business) throw notFound("Negocio no encontrado");

    if (!['sales','refunds'].includes(kind) && req.headers['x-signature'] === undefined) throw unauthorized('La confirmación de canjes requiere una firma x-signature.');
    const recovering = ['checkout/status','checkout/cancel','checkout/authorize','redemptions/events'].includes(kind);
    await verifyPosCredentials(business, {
      allowDisabled: recovering,
      authorization: req.headers.authorization,
      signature: req.headers["x-signature"],
      rawBody: req.rawBody
    });

    const overrides = await plans.getPlanFeatureOverrides().catch(() => ({}));
    if (!recovering && !hasPlanFeature(business.plan, "external_awards", overrides)) {
      return res.status(403).json({
        error: "La funcionalidad 'external_awards' no está disponible en tu plan actual",
        code: "PLAN_FEATURE_LOCKED",
        feature: "external_awards",
        plan: business.plan,
        suggested_plan: suggestedPlanForFeature("external_awards")
      });
    }

    if (!recovering && (kind.startsWith('redemptions/') || ['checkout/options','checkout/authorize'].includes(kind)) && !hasPlanFeature(business.plan, 'redemptions', overrides)) return res.status(403).json({error:'Tu plan no incluye canjes.',code:'PLAN_FEATURE_LOCKED',feature:'redemptions'});
    if (!['sales','refunds'].includes(kind)) res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    if (kind==='redemptions/events') return res.json(await ingest(business, req.body, {enforceConnection:true,getPlanFeatureOverrides:async()=>overrides}));
    return res.json(await ingest(business, req.body));
  }));

  return router;
}

export const posRoutes = createPosRoutes();
