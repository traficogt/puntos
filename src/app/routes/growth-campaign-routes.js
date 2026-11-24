import {
  normalizeMeasurementPlan,
  planCampaignExperiment,
} from "../services/campaign-experiment-model.js";
import {
  MeasurementPlanInput,
  MeasurementCostInput,
} from "../services/campaign-measurement-input.js";
import {
  saveMeasurementCosts,
  saveMeasurementReport,
  listMeasurementReports,
} from "../services/campaign-report-service.js";
import {
  previewCampaignCollisions,
  CollisionSampleInput,
} from "../services/campaign-collision-service.js";
import { Router } from "express";
import { z } from "zod";
import { hasMaxScale } from "../../utils/money.js";
import { requireStaff, requireOwner, requireCustomer } from "../../middleware/auth.js";
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
import {
  createCampaignPreparation,
  retryCampaignPreparation,
  cancelCampaignPreparation,
} from "../services/campaign-preparation-service.js";
import { getCustomerGrowthOffers } from "../services/targeted-offer-service.js";
import { AUDIENCE_TECHNICAL_CEILING, SYNC_AUDIENCE_LIMIT } from "../services/scale-limits.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */

const uuid = z.guid().transform((value) => value.toLowerCase());
const Empty = z.object({}).strict();
const Params = z.object({ id: uuid }).strict();
/**
 * @param {number} minimum
 * @param {number} maximum
 * @param {number} fallback
 */
const integerQuery = (minimum, maximum, fallback) =>
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .default(String(fallback))
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));
const ListQuery = z
  .object({
    limit: integerQuery(1, 50, 20),
    offset: integerQuery(0, 100000, 0),
  })
  .strict();
const Money = z
  .number()
  .finite()
  .min(0)
  .max(999999.99)
  .refine((value) => hasMaxScale(value, 2));
const CreateBody = z
  .object({
    request_id: uuid,
    measurement_plan: MeasurementPlanInput.nullable().optional(),
    recovery_run_id: uuid.optional(),
    audience_segment_id: uuid.optional(),
    audience_segment_version: z.number().int().min(1).max(2147483647).optional(),
    // Up to the technical ceiling here; the service enforces the plan limit and the
    // handler sends audiences above SYNC_AUDIENCE_LIMIT to background preparation.
    audience_limit: z.number().int().min(10).max(AUDIENCE_TECHNICAL_CEILING).optional(),
    name: z.string().trim().min(1).max(100),
    bonus_points: z.number().int().min(1).max(10000),
    points_budget: z.number().int().min(1).max(2000000).nullable().default(null),
    minimum_purchase_q: Money.default(0),
    duration_days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    holdout_percent: z
      .union([z.literal(10), z.literal(20), z.literal(30), z.literal(50)])
      .default(20),
    estimated_cost_per_point_q: z.number().finite().min(0).max(100).nullable().default(null),
  })
  .strict()
  .refine((data) => Boolean(data.recovery_run_id) !== Boolean(data.audience_segment_id))
  .refine((data) =>
    data.audience_segment_id
      ? data.audience_segment_version !== undefined && data.audience_limit !== undefined
      : data.audience_segment_version === undefined && data.audience_limit === undefined,
  )
  .refine((data) => data.points_budget == null || data.points_budget >= data.bonus_points);

const ActivateBody = z.object({ preflight_id: uuid.optional() }).strict();
const ExpansionTerms = {
  request_id: uuid,
  name: z.string().trim().min(1).max(100),
  audience_segment_id: uuid,
  audience_segment_version: z.number().int().min(1).max(2147483647),
  bonus_points: z.number().int().min(1).max(10000),
  minimum_purchase_q: Money.default(0),
  estimated_cost_per_point_q: z.number().finite().min(0).max(100).nullable().default(null),
};
const QuietBody = z
  .object({
    ...ExpansionTerms,
    audience_limit: z.number().int().min(1).max(AUDIENCE_TECHNICAL_CEILING),
    points_budget: z.number().int().min(1).max(2000000),
    duration_minutes: z.number().int().min(30).max(240),
  })
  .strict()
  .refine((data) => data.points_budget >= data.bonus_points);
const PreparationBody = z
  .object({
    ...ExpansionTerms,
    audience_limit: z.number().int().min(10).max(AUDIENCE_TECHNICAL_CEILING),
    points_budget: z.number().int().min(1).max(2000000).nullable().default(null),
    measurement_plan: MeasurementPlanInput.nullable().optional(),
    duration_days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    holdout_percent: z
      .union([z.literal(10), z.literal(20), z.literal(30), z.literal(50)])
      .default(20),
  })
  .strict()
  .refine((data) => data.points_budget == null || data.points_budget >= data.bonus_points);

/** @typedef {z.infer<typeof MeasurementPlanInput>} MeasurementPlan */
/** @typedef {z.infer<typeof CreateBody>} CampaignCreateBody */
/**
 * Bodies that carry the shared `ExpansionTerms` (quiet offer or background preparation).
 * @typedef {z.infer<typeof QuietBody> | z.infer<typeof PreparationBody>} ExpansionData
 */
/**
 * What the campaign services receive to create or prepare a campaign.
 * @typedef {GrowthActor & {
 *   requestId: string,
 *   name: string,
 *   bonusPoints: number,
 *   pointsBudget: number | null,
 *   minimumPurchaseQ: number,
 *   estimatedCostPerPointQ: number | null,
 *   recoveryRunId?: string,
 *   audienceSegmentId?: string,
 *   audienceSegmentVersion?: number,
 *   audienceLimit?: number,
 *   durationDays: CampaignCreateBody["duration_days"] | null,
 *   holdoutPercent: number,
 *   measurementPlan?: MeasurementPlan | null,
 *   offerKind?: "quiet",
 *   durationMinutes?: number
 * }} GrowthCampaignOptions
 */
/** @typedef {(input: GrowthActor & { campaignId: string, preflightId?: string }) => Promise<unknown>} CampaignAction */
/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   createGrowthCampaign: (input: GrowthCampaignOptions) => Promise<unknown>,
 *   createCampaignPreparation: (input: Omit<GrowthCampaignOptions, "recoveryRunId">) => Promise<unknown>,
 *   listGrowthCampaigns: (input: { businessId: string, limit: number, offset: number }) => Promise<unknown>,
 *   getGrowthCampaign: (input: { businessId: string, campaignId: string }) => Promise<unknown>,
 *   activateGrowthCampaign: CampaignAction,
 *   pauseGrowthCampaign: CampaignAction,
 *   createCampaignPreflight: CampaignAction,
 *   retryCampaignPreparation: CampaignAction,
 *   cancelCampaignPreparation: CampaignAction,
 *   previewCampaignCollisions: (input: GrowthActor & {
 *     campaignId: string,
 *     input: z.infer<typeof CollisionSampleInput>
 *   }) => Promise<unknown>,
 *   saveMeasurementCosts: (input: GrowthActor & {
 *     campaignId: string,
 *     requestId: string,
 *     costs: z.infer<typeof MeasurementCostInput>
 *   }) => Promise<unknown>,
 *   saveMeasurementReport: (input: GrowthActor & { campaignId: string, requestId: string }) => Promise<unknown>,
 *   listMeasurementReports: (input: { businessId: string, campaignId: string }) => Promise<unknown>
 * }} GrowthCampaignDeps
 */
/**
 * @typedef {{
 *   getCustomerGrowthOffers: (input: { businessId: string, customerId: string }) => Promise<unknown>
 * }} CustomerGrowthOffersDeps
 */

/** @param {ExpansionData} data */
function expansionOptions(data) {
  return {
    requestId: data.request_id,
    name: data.name,
    audienceSegmentId: data.audience_segment_id,
    audienceSegmentVersion: data.audience_segment_version,
    audienceLimit: data.audience_limit,
    bonusPoints: data.bonus_points,
    pointsBudget: data.points_budget,
    minimumPurchaseQ: data.minimum_purchase_q,
    estimatedCostPerPointQ: data.estimated_cost_per_point_q,
  };
}

/** @param {Response} res */
function invalid(res) {
  return res.status(400).json({
    error: "Revisa los datos y los límites de esta solicitud.",
    code: "VALIDATION_ERROR",
  });
}
/** @param {Request} _req @param {Response} res @param {NextFunction} next */
function noStore(_req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}
/** @param {TenantRequest} req */
function actor(req) {
  return {
    businessId: req.tenantId,
    staffId: req.staff.id,
    ip: req.ip,
    ua: req.get("user-agent") || null,
    ...(req.staff.impersonated_by ? { impersonated_by: req.staff.impersonated_by } : {}),
  };
}
/** @typedef {ReturnType<typeof actor>} GrowthActor */

/** @param {Partial<GrowthCampaignDeps>} [deps] */
export function createGrowthCampaignRouter(deps = {}) {
  /** @type {GrowthCampaignDeps} */
  const services = {
    createGrowthCampaign,
    saveMeasurementCosts,
    saveMeasurementReport,
    listMeasurementReports,
    listGrowthCampaigns,
    getGrowthCampaign,
    activateGrowthCampaign,
    pauseGrowthCampaign,
    previewCampaignCollisions,
    createCampaignPreflight,
    createCampaignPreparation,
    retryCampaignPreparation,
    cancelCampaignPreparation,
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
  router.post(
    `${base}/measurement-plan`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const body = z
          .object({
            measurement_plan: MeasurementPlanInput,
            duration_days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
            holdout_percent: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50)]),
            available_members: z.number().int().min(0).max(5000).nullable(),
          })
          .strict()
          .safeParse(req.body);
        if (!body.success || !Empty.safeParse(req.query).success) return invalid(res);
        const d = body.data,
          plan = normalizeMeasurementPlan(d.measurement_plan, {
            durationDays: d.duration_days,
            holdoutPercent: d.holdout_percent,
          });
        return res.json({
          planning: planCampaignExperiment({
            plan,
            holdoutPercent: d.holdout_percent,
            availableMembers: d.available_members,
          }),
        });
      },
    ),
  );
  router.post(
    `${base}/:id/measurement-costs`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const params = Params.safeParse(req.params),
          input = MeasurementCostInput.extend({ request_id: uuid }).safeParse(req.body);
        if (!params.success || !input.success || !Empty.safeParse(req.query).success)
          return invalid(res);
        const { request_id, ...costs } = input.data;
        return res.status(201).json(
          await services.saveMeasurementCosts({
            ...actor(req),
            campaignId: params.data.id,
            requestId: request_id,
            costs,
          }),
        );
      },
    ),
  );
  router.post(
    `${base}/:id/measurement-reports`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const params = Params.safeParse(req.params),
          input = z.object({ request_id: uuid }).strict().safeParse(req.body);
        if (!params.success || !input.success || !Empty.safeParse(req.query).success)
          return invalid(res);
        return res.status(201).json(
          await services.saveMeasurementReport({
            ...actor(req),
            campaignId: params.data.id,
            requestId: input.data.request_id,
          }),
        );
      },
    ),
  );
  router.get(
    `${base}/:id/measurement-reports`,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const params = Params.safeParse(req.params);
        if (!params.success || !Empty.safeParse(req.query).success) return invalid(res);
        return res.json(
          await services.listMeasurementReports({
            businessId: req.tenantId,
            campaignId: params.data.id,
          }),
        );
      },
    ),
  );
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const parsed = ListQuery.safeParse(req.query);
        if (!parsed.success) return invalid(res);
        return res.json(
          await services.listGrowthCampaigns({
            businessId: req.tenantId,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
          }),
        );
      },
    ),
  );
  router.post(
    base,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const body = CreateBody.safeParse(req.body);
        if (!body.success || !Empty.safeParse(req.query).success) return invalid(res);
        const data = body.data;
        normalizeMeasurementPlan(data.measurement_plan ?? null, {
          durationDays: data.duration_days,
          holdoutPercent: data.holdout_percent,
        });
        /** @type {GrowthCampaignOptions} */
        const options = {
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
          measurementPlan: data.measurement_plan,
        };
        // Saved audiences above the synchronous bound are prepared by the job queue in
        // chunks (202 Accepted); the plan limit is enforced inside the service either way.
        if (data.audience_segment_id && (data.audience_limit ?? 0) > SYNC_AUDIENCE_LIMIT) {
          const { recoveryRunId: _run, ...prepared } = options;
          return res.status(202).json(await services.createCampaignPreparation(prepared));
        }
        return res.status(201).json(await services.createGrowthCampaign(options));
      },
    ),
  );
  router.post(
    `${base}/quiet`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const body = QuietBody.safeParse(req.body);
        if (!body.success || !Empty.safeParse(req.query).success) return invalid(res);
        /** @type {GrowthCampaignOptions} */
        const options = {
          ...actor(req),
          ...expansionOptions(body.data),
          offerKind: "quiet",
          durationMinutes: body.data.duration_minutes,
          durationDays: null,
          holdoutPercent: 0,
        };
        if (body.data.audience_limit > SYNC_AUDIENCE_LIMIT)
          return res.status(202).json(await services.createCampaignPreparation(options));
        return res.status(201).json(await services.createGrowthCampaign(options));
      },
    ),
  );
  router.post(
    `${base}/prepare`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const body = PreparationBody.safeParse(req.body);
        if (!body.success || !Empty.safeParse(req.query).success) return invalid(res);
        normalizeMeasurementPlan(body.data.measurement_plan ?? null, {
          durationDays: body.data.duration_days,
          holdoutPercent: body.data.holdout_percent,
        });
        return res.status(202).json(
          await services.createCampaignPreparation({
            ...actor(req),
            ...expansionOptions(body.data),
            durationDays: body.data.duration_days,
            holdoutPercent: body.data.holdout_percent,
            measurementPlan: body.data.measurement_plan,
          }),
        );
      },
    ),
  );
  router.post(
    `${base}/:id/collision-preview`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const params = Params.safeParse(req.params),
          input = CollisionSampleInput.safeParse(req.body);
        if (!params.success || !input.success || !Empty.safeParse(req.query).success)
          return invalid(res);
        return res.json(
          await services.previewCampaignCollisions({
            ...actor(req),
            campaignId: params.data.id,
            input: input.data,
          }),
        );
      },
    ),
  );
  for (const [suffix, execute] of Object.entries({
    preflight: services.createCampaignPreflight,
    "preparation/retry": services.retryCampaignPreparation,
    "preparation/cancel": services.cancelCampaignPreparation,
  })) {
    router.post(
      `${base}/:id/${suffix}`,
      csrfProtect,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          const params = Params.safeParse(req.params);
          if (
            !params.success ||
            !Empty.safeParse(req.query).success ||
            !Empty.safeParse(req.body ?? {}).success
          )
            return invalid(res);
          return res.json(await execute({ ...actor(req), campaignId: params.data.id }));
        },
      ),
    );
  }
  router.get(
    `${base}/:id`,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const params = Params.safeParse(req.params);
        if (!params.success || !Empty.safeParse(req.query).success) return invalid(res);
        return res.json(
          await services.getGrowthCampaign({
            businessId: req.tenantId,
            campaignId: params.data.id,
          }),
        );
      },
    ),
  );
  for (const [action, execute] of Object.entries({
    activate: services.activateGrowthCampaign,
    pause: services.pauseGrowthCampaign,
  })) {
    router.post(
      `${base}/:id/${action}`,
      csrfProtect,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          const params = Params.safeParse(req.params);
          if (
            !params.success ||
            !Empty.safeParse(req.query).success ||
            !(action === "activate" ? ActivateBody : Empty).safeParse(req.body ?? {}).success
          )
            return invalid(res);
          return res.json(
            await execute({
              ...actor(req),
              campaignId: params.data.id,
              ...(action === "activate" && req.body?.preflight_id
                ? { preflightId: ActivateBody.parse(req.body).preflight_id }
                : {}),
            }),
          );
        },
      ),
    );
  }
  return router;
}

/** @param {Partial<CustomerGrowthOffersDeps>} [deps] */
export function createCustomerGrowthOffersRouter(deps = {}) {
  /** @type {CustomerGrowthOffersDeps} */
  const services = { getCustomerGrowthOffers, ...deps };
  const router = Router();
  router.get(
    "/customer/growth-offers",
    noStore,
    requireCustomer,
    tenantContext,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!Empty.safeParse(req.query).success) return invalid(res);
        return res.json(
          await services.getCustomerGrowthOffers({
            businessId: req.tenantId,
            customerId: req.customerAuth.id,
          }),
        );
      },
    ),
  );
  return router;
}
