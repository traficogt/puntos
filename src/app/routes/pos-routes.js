import {
  getPosCheckoutOptions,
  authorizePosCheckout,
  getPosCheckoutStatus,
  cancelPosCheckout,
} from "../services/pos-checkout-service.js";
import { recordDataHeartbeat } from "../services/data-health-service.js";
import {
  syncMerchantCatalog,
  recordInventorySnapshot,
} from "../services/merchant-catalog-service.js";
import {
  lookupPosRedemption,
  recordPosFulfillmentEvent,
} from "../services/redemption-pos-event-service.js";
import { getPosRewardMappings } from "../services/reward-pos-mapping-service.js";
import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { setTenantForRequest } from "../../middleware/tenant.js";
import { hasPlanFeature, suggestedPlanForFeature } from "../../utils/plan.js";
import { notFound, unauthorized } from "../../utils/http-error.js";
import { validationErrorBody } from "../../utils/schemas.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { PlanConfigService } from "../services/plan-config-service.js";
import { verifyPosCredentials } from "../services/pos/common.js";
import { ingestPosSale } from "../services/pos-integration-service.js";
import { ingestPosRefund } from "../services/pos-refund-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/**
 * @template P
 * @typedef {import("./_request-types.js").ParamsRequest<P>} ParamsRequest
 */
/** @typedef {import("../repositories/business-repository.js").BusinessRow} BusinessRow */

// Structural shape of each POS payload: required keys and primitive types only.
// Each service still applies its own strict schema (formats, ranges, unknown
// keys), so these never reject a payload the service would accept; they only
// turn a malformed envelope into a 400 with field details. Unknown keys pass
// through so the service's strict checks keep seeing them.
const text = z.string();
const num = z.number();
const checkoutIdentity = { source: text, branchId: text.nullable() };
const posBodyShapes = {
  "catalog/sync": z.looseObject({
    source: text,
    requestId: text,
    observedAt: text,
    items: z.array(z.looseObject({})),
  }),
  "inventory/snapshot": z.looseObject({
    source: text,
    requestId: text,
    branchId: text,
    observedAt: text,
    items: z.array(z.looseObject({})),
  }),
  "checkout/options": z.looseObject({ ...checkoutIdentity, customerQrToken: text }),
  "checkout/authorize": z.looseObject({
    ...checkoutIdentity,
    requestId: text,
    cartId: text,
    cartLineId: text,
    customerId: text,
    customerQrToken: text,
    rewardId: text,
    mappingId: text,
    mappingVersion: num,
    operatorRef: text,
  }),
  "checkout/status": z.looseObject({ ...checkoutIdentity, requestId: text }),
  "checkout/cancel": z.looseObject({
    ...checkoutIdentity,
    requestId: text,
    cancelRequestId: text,
    cartId: text,
    cartLineId: text,
    reason: text,
    orderState: text,
    rewardLineRemoved: z.boolean(),
  }),
  sales: z.looseObject({
    saleId: text,
    customerPhone: text,
    amountQ: num,
    status: z.enum(["paid", "completed"]),
    source: text.nullish(),
    currency: text.optional(),
    items: num.nullish(),
    occurredAt: text.nullish(),
    dryRun: z.boolean().optional(),
  }),
  refunds: z.looseObject({
    refundId: text,
    originalSaleId: text,
    source: text,
    amountQ: num,
    currency: text,
    scope: z.enum(["full", "partial", "unknown"]).optional(),
  }),
  "redemptions/lookup": z.looseObject({ source: text, code: text }),
  "redemptions/events": z.looseObject({
    eventId: text,
    redemptionId: text,
    source: text,
    orderId: text,
    lineId: text,
    productRef: text,
    quantity: num,
    currency: text,
    mappingId: text,
    mappingVersion: num,
    kind: z.enum(["recorded", "reversed", "stock_updated"]),
    stockStatus: text,
    lineTotal: num,
  }),
  "redemptions/mappings": z.looseObject({ source: text }),
  "health/heartbeat": z.looseObject({
    request_id: text,
    monitor_id: text,
    coverage_through: text,
    status: z.enum(["complete", "partial", "error"]),
    pending: num,
    errors: num,
  }),
};

/** @typedef {keyof typeof posBodyShapes} PosKind */
/**
 * A POS ingestion service: receives the tenant business and the shape-checked
 * payload. Each service may take its own injected-dependency bag as a third
 * parameter, which this dispatcher never passes; the redemption-event ingest,
 * which does receive connection-enforcement options, is typed by its own
 * signature below.
 * @typedef {(business: BusinessRow, input: Record<string, unknown>) => Promise<unknown>} PosIngest
 */
/**
 * Collaborators the router resolves per request. Unit tests inject fakes for
 * the repository lookups and the ingestion services.
 * @typedef {{
 *   BusinessRepo: Pick<typeof BusinessRepo, "getPublicBySlug" | "getById">,
 *   PlanConfigService: Pick<typeof PlanConfigService, "getPlanFeatureOverrides">,
 *   setTenantForRequest: (req: Request, businessId: string) => Promise<void>,
 *   syncMerchantCatalog: PosIngest,
 *   recordInventorySnapshot: PosIngest,
 *   getPosCheckoutOptions: PosIngest,
 *   authorizePosCheckout: PosIngest,
 *   getPosCheckoutStatus: PosIngest,
 *   cancelPosCheckout: PosIngest,
 *   ingestPosSale: PosIngest,
 *   ingestPosRefund: PosIngest,
 *   lookupPosRedemption: PosIngest,
 *   recordPosFulfillmentEvent: typeof recordPosFulfillmentEvent,
 *   getPosRewardMappings: PosIngest,
 *   recordDataHeartbeat: PosIngest
 * }} PosRouteDeps
 */

/** @param {Partial<PosRouteDeps>} [deps] */
export function createPosRoutes(deps = {}) {
  const router = Router();
  const businessRepo = deps.BusinessRepo ?? BusinessRepo;
  const plans = deps.PlanConfigService ?? PlanConfigService;
  const setTenant = deps.setTenantForRequest ?? setTenantForRequest;
  const fulfillmentEvent = deps.recordPosFulfillmentEvent ?? recordPosFulfillmentEvent;
  /** @type {Partial<Record<PosKind, PosIngest>>} */
  const handlers = {
    "catalog/sync": deps.syncMerchantCatalog ?? syncMerchantCatalog,
    "inventory/snapshot": deps.recordInventorySnapshot ?? recordInventorySnapshot,
    "checkout/options": deps.getPosCheckoutOptions ?? getPosCheckoutOptions,
    "checkout/authorize": deps.authorizePosCheckout ?? authorizePosCheckout,
    "checkout/status": deps.getPosCheckoutStatus ?? getPosCheckoutStatus,
    "checkout/cancel": deps.cancelPosCheckout ?? cancelPosCheckout,
    sales: deps.ingestPosSale ?? ingestPosSale,
    refunds: deps.ingestPosRefund ?? ingestPosRefund,
    "redemptions/lookup": deps.lookupPosRedemption ?? lookupPosRedemption,
    "redemptions/events": fulfillmentEvent,
    "redemptions/mappings": deps.getPosRewardMappings ?? getPosRewardMappings,
  };

  handlers["health/heartbeat"] = deps.recordDataHeartbeat ?? recordDataHeartbeat;
  // Every key above is filled, so the entries carry a handler for each kind.
  for (const [kind, ingest] of /** @type {[PosKind, PosIngest][]} */ (Object.entries(handlers)))
    router.post(
      `/public/pos/:slug/${kind}`,
      moderateRateLimit,
      asyncRoute(
        /** @param {ParamsRequest<{ slug: string }>} req @param {Response} res */
        async (req, res) => {
          const publicBusiness = await businessRepo.getPublicBySlug(req.params.slug);
          if (!publicBusiness) throw notFound("Negocio no encontrado");

          await setTenant(req, publicBusiness.id);
          const business = await businessRepo.getById(publicBusiness.id);
          if (!business) throw notFound("Negocio no encontrado");

          if (!["sales", "refunds"].includes(kind) && req.headers["x-signature"] === undefined)
            throw unauthorized("La confirmación de canjes requiere una firma x-signature.");
          const recovering = [
            "checkout/status",
            "checkout/cancel",
            "checkout/authorize",
            "redemptions/events",
          ].includes(kind);
          await verifyPosCredentials(business, {
            allowDisabled: recovering,
            authorization: req.headers.authorization,
            signature: req.headers["x-signature"],
            rawBody: req.rawBody,
          });

          const overrides = await plans.getPlanFeatureOverrides().catch(() => ({}));
          if (!recovering && !hasPlanFeature(business.plan, "external_awards", overrides)) {
            return res.status(403).json({
              error: "La funcionalidad 'external_awards' no está disponible en tu plan actual",
              code: "PLAN_FEATURE_LOCKED",
              feature: "external_awards",
              plan: business.plan,
              suggested_plan: suggestedPlanForFeature("external_awards"),
            });
          }

          if (
            !recovering &&
            (kind.startsWith("redemptions/") ||
              ["checkout/options", "checkout/authorize"].includes(kind)) &&
            !hasPlanFeature(business.plan, "redemptions", overrides)
          )
            return res.status(403).json({
              error: "Tu plan no incluye canjes.",
              code: "PLAN_FEATURE_LOCKED",
              feature: "redemptions",
            });
          if (!["sales", "refunds"].includes(kind))
            res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
          // Shape check runs only after credentials and plan gates, so unauthenticated
          // callers learn nothing about the payload contract.
          const shape = posBodyShapes[kind].safeParse(req.body);
          if (!shape.success) return res.status(400).json(validationErrorBody(shape.error));
          if (kind === "redemptions/events")
            return res.json(
              await fulfillmentEvent(business, shape.data, {
                enforceConnection: true,
                getPlanFeatureOverrides: async () => overrides,
              }),
            );
          return res.json(await ingest(business, shape.data));
        },
      ),
    );

  return router;
}

export const posRoutes = createPosRoutes();
