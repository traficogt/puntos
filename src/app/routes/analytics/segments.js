import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { uuidParamsSchema, validateParams, validateQuery } from "../../../utils/schemas.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner } from "../../../middleware/auth.js";
import { AnalyticsRepository } from "../../repositories/analytics-repository.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */
/**
 * @template Q
 * @typedef {import("../_request-types.js").WithValidatedQuery<Q>} WithValidatedQuery
 */
/**
 * @template P
 * @typedef {import("../_request-types.js").WithValidatedParams<P>} WithValidatedParams
 */
/** @typedef {z.infer<typeof uuidParamsSchema>} UuidParams */

export const analyticsSegmentRoutes = Router();

export const CreateSegmentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  segment_type: z.enum(["rfm", "behavioral", "custom"]),
  criteria: z.record(z.string(), z.any()).default({}),
  auto_update: z.boolean().optional(),
  color: z.string().max(20).optional(),
});

export const SegmentCustomersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** @typedef {z.infer<typeof SegmentCustomersQuerySchema>} SegmentCustomersQuery */

analyticsSegmentRoutes.get(
  "/admin/analytics/segments",
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const segments = await AnalyticsRepository.listSegments(req.tenantId);
      return res.json({ ok: true, segments });
    },
  ),
);

analyticsSegmentRoutes.post(
  "/admin/analytics/segments",
  csrfProtect,
  requireOwner,
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const v = validate(CreateSegmentSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const segmentData = {
        business_id: req.tenantId,
        name: v.data.name,
        description: v.data.description,
        segment_type: v.data.segment_type,
        criteria: v.data.criteria,
        auto_update: v.data.auto_update !== false,
        color: v.data.color,
      };

      const segment = await AnalyticsRepository.createSegment(segmentData);
      return res.status(201).json({ ok: true, segment });
    },
  ),
);

analyticsSegmentRoutes.get(
  "/admin/analytics/segments/:id",
  validateParams(uuidParamsSchema),
  validateQuery(SegmentCustomersQuerySchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedParams<UuidParams> & WithValidatedQuery<SegmentCustomersQuery>} req @param {Response} res */
    async (req, res) => {
      const { limit, offset } = req.validatedQuery;

      const customers = await AnalyticsRepository.getSegmentCustomers(
        req.tenantId,
        req.validatedParams.id,
        limit,
        offset,
      );

      return res.json({ ok: true, customers, limit, offset });
    },
  ),
);
