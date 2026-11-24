import { Router } from "express";
import { z } from "zod";

import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner } from "../../../middleware/auth.js";
import { validate } from "../../../utils/validation.js";
import { uuidParamsSchema, validateParams, validateQuery } from "../../../utils/schemas.js";
import {
  applyLedgerCorrection,
  listLedgerCorrections,
  rejectLedgerCorrection,
  requestLedgerCorrection,
} from "../../services/ledger-correction-service.js";

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

export const analyticsCorrectionRoutes = Router();

const CorrectionCreateSchema = z.object({
  customerId: z.guid(),
  reason: z.string().min(8).max(500),
  sourceRunId: z.guid().optional(),
  sourceFindingId: z.guid().optional(),
});

const CorrectionRejectSchema = z.object({
  reason: z.string().min(8).max(500),
});

// The service clamps `limit` into 1..200 and defaults blanks to 50, so only a
// non-numeric value is rejected here; numeric values keep their historical
// clamping instead of becoming new rejections.
const CorrectionListQuerySchema = z.object({
  limit: z.coerce.number().optional(),
});

/** @typedef {z.infer<typeof CorrectionListQuerySchema>} CorrectionListQuery */

analyticsCorrectionRoutes.get(
  "/admin/analytics/ledger-corrections",
  validateQuery(CorrectionListQuerySchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedQuery<CorrectionListQuery>} req @param {Response} res */
    async (req, res) => {
      const corrections = await listLedgerCorrections({
        businessId: req.tenantId,
        limit: req.validatedQuery.limit || 50,
      });
      return res.json({ ok: true, corrections });
    },
  ),
);

analyticsCorrectionRoutes.post(
  "/admin/analytics/ledger-corrections",
  requireOwner,
  csrfProtect,
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const v = validate(CorrectionCreateSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });

      const out = await requestLedgerCorrection({
        businessId: req.tenantId,
        customerId: v.data.customerId,
        requestedByStaffId: req.staff.id,
        reason: v.data.reason,
        sourceRunId: v.data.sourceRunId ?? null,
        sourceFindingId: v.data.sourceFindingId ?? null,
        ip: req.ip,
        ua: req.get?.("user-agent") || null,
      });

      return res.status(201).json(out);
    },
  ),
);

analyticsCorrectionRoutes.post(
  "/admin/analytics/ledger-corrections/:id/apply",
  requireOwner,
  csrfProtect,
  validateParams(uuidParamsSchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedParams<UuidParams>} req @param {Response} res */
    async (req, res) => {
      const out = await applyLedgerCorrection({
        businessId: req.tenantId,
        correctionId: req.validatedParams.id,
        resolvedByStaffId: req.staff.id,
        ip: req.ip,
        ua: req.get?.("user-agent") || null,
      });
      return res.json(out);
    },
  ),
);

analyticsCorrectionRoutes.post(
  "/admin/analytics/ledger-corrections/:id/reject",
  requireOwner,
  csrfProtect,
  validateParams(uuidParamsSchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedParams<UuidParams>} req @param {Response} res */
    async (req, res) => {
      const v = validate(CorrectionRejectSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });

      const out = await rejectLedgerCorrection({
        businessId: req.tenantId,
        correctionId: req.validatedParams.id,
        resolvedByStaffId: req.staff.id,
        reason: v.data.reason,
        ip: req.ip,
        ua: req.get?.("user-agent") || null,
      });
      return res.json(out);
    },
  ),
);
