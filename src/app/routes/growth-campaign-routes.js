import { Router } from "express";
import { z } from "zod";
import {
  requireStaff,
  requireOwner,
  requireCustomer,
} from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import {
  createGrowthCampaign,
  listGrowthCampaigns,
  getGrowthCampaign,
  activateGrowthCampaign,
  pauseGrowthCampaign,
} from "../services/growth-campaign-service.js";
import { createCampaignPreflight } from "../services/campaign-preflight-service.js";
import { createCampaignPreparation, retryCampaignPreparation, cancelCampaignPreparation } from "../services/campaign-preparation-service.js";
import { getCustomerGrowthOffers } from "../services/targeted-offer-service.js";

const uuid = z.guid()
  .transform((value) => value.toLowerCase());
const Empty = z.object({}).strict();
const Params = z.object({ id: uuid }).strict();
const integerQuery = (minimum, maximum, fallback) => z.string()
  .regex(/^(0|[1-9]\d*)$/).default(String(fallback)).transform(Number)
  .pipe(z.number().int().min(minimum).max(maximum));
const ListQuery = z.object({
  limit: integerQuery(1, 50, 20),
  offset: integerQuery(0, 100000, 0),
}).strict();
const Money = z
  .number()
  .finite()
  .min(0)
  .max(999999.99)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) <= 0.00001,
  );
const CreateBody = z
  .object({
    request_id: uuid,
    recovery_run_id: uuid.optional(),
    audience_segment_id: uuid.optional(),
    audience_segment_version: z.number().int().min(1).max(2147483647).optional(),
    audience_limit: z.number().int().min(10).max(200).optional(),
    name: z.string().trim().min(1).max(100),
    bonus_points: z.number().int().min(1).max(10000),
    points_budget: z.number().int().min(1).max(2000000).nullable().default(null),
    minimum_purchase_q: Money.default(0),
    duration_days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    holdout_percent: z
      .union([z.literal(10), z.literal(20), z.literal(30)])
      .default(20),
    estimated_cost_per_point_q: z
      .number()
      .finite()
      .min(0)
      .max(100)
      .nullable()
      .default(null),
  })
  .strict()
  .refine(data => Boolean(data.recovery_run_id) !== Boolean(data.audience_segment_id))
  .refine(data => data.audience_segment_id
    ? data.audience_segment_version !== undefined && data.audience_limit !== undefined
    : data.audience_segment_version === undefined && data.audience_limit === undefined)
  .refine(data => data.points_budget == null || data.points_budget >= data.bonus_points);

const ActivateBody = z.object({ preflight_id: uuid.optional() }).strict();
const ExpansionTerms = {
  request_id: uuid, name: z.string().trim().min(1).max(100),
  audience_segment_id: uuid, audience_segment_version: z.number().int().min(1).max(2147483647),
  bonus_points: z.number().int().min(1).max(10000), minimum_purchase_q: Money.default(0),
  estimated_cost_per_point_q: z.number().finite().min(0).max(100).nullable().default(null),
};
const QuietBody = z.object({ ...ExpansionTerms, audience_limit: z.number().int().min(1).max(200),
  points_budget: z.number().int().min(1).max(2000000), duration_minutes: z.number().int().min(30).max(240),
}).strict().refine(data => data.points_budget >= data.bonus_points);
const PreparationBody = z.object({ ...ExpansionTerms, audience_limit: z.number().int().min(10).max(5000),
  points_budget: z.number().int().min(1).max(2000000).nullable().default(null),
  duration_days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
  holdout_percent: z.union([z.literal(10), z.literal(20), z.literal(30)]).default(20),
}).strict().refine(data => data.points_budget == null || data.points_budget >= data.bonus_points);
function expansionOptions(data) {
  return { requestId: data.request_id, name: data.name, audienceSegmentId: data.audience_segment_id,
    audienceSegmentVersion: data.audience_segment_version, audienceLimit: data.audience_limit,
    bonusPoints: data.bonus_points, pointsBudget: data.points_budget, minimumPurchaseQ: data.minimum_purchase_q,
    estimatedCostPerPointQ: data.estimated_cost_per_point_q };
}

function invalid(res) {
  return res
    .status(400)
    .json({
      error: "Revisa los datos y los límites de esta solicitud.",
      code: "VALIDATION_ERROR",
    });
}
function noStore(_req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}
function actor(req) {
  return {
    businessId: req.tenantId,
    staffId: req.staff.id,
    ip: req.ip,
    ua: req.get("user-agent") || null,
    ...(req.staff.impersonated_by ? { impersonated_by: req.staff.impersonated_by } : {}),
  };
}

export function createGrowthCampaignRouter(deps = {}) {
  const services = {
    createGrowthCampaign,
    listGrowthCampaigns,
    getGrowthCampaign,
    activateGrowthCampaign,
    pauseGrowthCampaign,
    createCampaignPreflight, createCampaignPreparation, retryCampaignPreparation, cancelCampaignPreparation,
    ...deps,
  };
  const router = Router();
  const base = "/admin/growth-campaigns";
  router.use(
    base,
    noStore,
    requireStaff,
    tenantContext,
    requireOwner,
    requirePlanFeature("campaign_rules"),
    requirePlanFeature("analytics"),
  );
  router.get(
    base,
    asyncRoute(async (req, res) => {
      const parsed = ListQuery.safeParse(req.query);
      if (!parsed.success) return invalid(res);
      return res.json(
        await services.listGrowthCampaigns({ businessId: req.tenantId, limit: parsed.data.limit, offset: parsed.data.offset }),
      );
    }),
  );
  router.post(
    base,
    csrfProtect,
    asyncRoute(async (req, res) => {
      const body = CreateBody.safeParse(req.body);
      if (!body.success || !Empty.safeParse(req.query).success)
        return invalid(res);
      const data = body.data;
      return res
        .status(201)
        .json(
          await services.createGrowthCampaign({
            ...actor(req),
            requestId: data.request_id,
            recoveryRunId: data.recovery_run_id,
            audienceSegmentId: data.audience_segment_id,
            audienceSegmentVersion: data.audience_segment_version,
            audienceLimit: data.audience_limit,
            name: data.name,
            bonusPoints: data.bonus_points,
            pointsBudget: data.points_budget,
            minimumPurchaseQ: data.minimum_purchase_q,
            durationDays: data.duration_days,
            holdoutPercent: data.holdout_percent,
            estimatedCostPerPointQ: data.estimated_cost_per_point_q,
          }),
        );
    }),
  );
  router.post(`${base}/quiet`, csrfProtect, asyncRoute(async (req,res) => {
    const body = QuietBody.safeParse(req.body);
    if (!body.success || !Empty.safeParse(req.query).success) return invalid(res);
    return res.status(201).json(await services.createGrowthCampaign({ ...actor(req), ...expansionOptions(body.data),
      offerKind: "quiet", durationMinutes: body.data.duration_minutes, durationDays: null, holdoutPercent: 0 }));
  }));
  router.post(`${base}/prepare`, csrfProtect, asyncRoute(async (req,res) => {
    const body = PreparationBody.safeParse(req.body);
    if (!body.success || !Empty.safeParse(req.query).success) return invalid(res);
    return res.status(202).json(await services.createCampaignPreparation({ ...actor(req), ...expansionOptions(body.data),
      durationDays: body.data.duration_days, holdoutPercent: body.data.holdout_percent }));
  }));
  for (const [suffix, execute] of Object.entries({ preflight: services.createCampaignPreflight,
    "preparation/retry": services.retryCampaignPreparation, "preparation/cancel": services.cancelCampaignPreparation })) {
    router.post(`${base}/:id/${suffix}`, csrfProtect, asyncRoute(async (req,res) => {
      const params = Params.safeParse(req.params);
      if (!params.success || !Empty.safeParse(req.query).success || !Empty.safeParse(req.body ?? {}).success) return invalid(res);
      return res.json(await execute({ ...actor(req), campaignId: params.data.id }));
    }));
  }
  router.get(
    `${base}/:id`,
    asyncRoute(async (req, res) => {
      const params = Params.safeParse(req.params);
      if (!params.success || !Empty.safeParse(req.query).success)
        return invalid(res);
      return res.json(
        await services.getGrowthCampaign({
          businessId: req.tenantId,
          campaignId: params.data.id,
        }),
      );
    }),
  );
  for (const [action, execute] of Object.entries({
    activate: services.activateGrowthCampaign,
    pause: services.pauseGrowthCampaign,
  })) {
    router.post(
      `${base}/:id/${action}`,
      csrfProtect,
      asyncRoute(async (req, res) => {
        const params = Params.safeParse(req.params);
        if (
          !params.success ||
          !Empty.safeParse(req.query).success ||
          !(action === "activate" ? ActivateBody : Empty).safeParse(req.body ?? {}).success
        )
          return invalid(res);
        return res.json(
          await execute({ ...actor(req), campaignId: params.data.id, ...(action === "activate" && req.body?.preflight_id ? { preflightId: ActivateBody.parse(req.body).preflight_id } : {}) }),
        );
      }),
    );
  }
  return router;
}

export function createCustomerGrowthOffersRouter(deps = {}) {
  const services = { getCustomerGrowthOffers, ...deps };
  const router = Router();
  router.get(
    "/customer/growth-offers",
    noStore,
    requireCustomer,
    tenantContext,
    asyncRoute(async (req, res) => {
      if (!Empty.safeParse(req.query).success) return invalid(res);
      return res.json(
        await services.getCustomerGrowthOffers({
          businessId: req.tenantId,
          customerId: req.customerAuth.id,
        }),
      );
    }),
  );
  return router;
}
