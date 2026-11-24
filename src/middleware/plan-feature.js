import { BusinessRepo } from "../app/repositories/business-repository.js";
import { hasPlanFeature, suggestedPlanForFeature } from "../utils/plan.js";
import { PlanConfigService } from "../app/services/plan-config-service.js";

/** @typedef {import("express").Request} Request */
/** @typedef {import("../types/auth.js").AnnotatedRequestHandler} AnnotatedRequestHandler */

/**
 * The authenticated actor's business, loaded once per request.
 * @param {Request} req
 */
async function resolveBusiness(req) {
  const businessId = req.staff?.business_id || req.customerAuth?.business_id;
  if (!businessId) return null;

  if (req._resolvedBusiness && req._resolvedBusiness.id === businessId) {
    return req._resolvedBusiness;
  }

  const business = await BusinessRepo.getById(businessId);
  req._resolvedBusiness = business;
  return business;
}

/**
 * Answers 403 PLAN_FEATURE_LOCKED unless the business's plan (with platform
 * overrides) enables `feature`.
 * @param {string} feature a key of the plan feature table (src/utils/plan.js)
 */
export function requirePlanFeature(feature) {
  /** @type {AnnotatedRequestHandler} */
  const middleware = async (req, res, next) => {
    const business = await resolveBusiness(req);
    if (!business)
      return res
        .status(401)
        .json({ error: "Contexto de negocio requerido", code: "BUSINESS_CONTEXT_REQUIRED" });
    const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));

    if (hasPlanFeature(business.plan, feature, overrides)) return next();

    return res.status(403).json({
      error: `La funcionalidad '${feature}' no está disponible en tu plan actual`,
      code: "PLAN_FEATURE_LOCKED",
      feature,
      plan: business.plan,
      suggested_plan: suggestedPlanForFeature(feature),
    });
  };
  middleware.__openapi = { planFeatures: [feature] };
  return middleware;
}
