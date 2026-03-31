import { Router } from "express";
import { z } from "zod";

import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner } from "../../../middleware/auth.js";
import { validate } from "../../../utils/validation.js";
import {
  applyLedgerCorrection,
  listLedgerCorrections,
  rejectLedgerCorrection,
  requestLedgerCorrection
} from "../../services/ledger-correction-service.js";

export const analyticsCorrectionRoutes = Router();

const CorrectionCreateSchema = z.object({
  customerId: z.string().uuid(),
  reason: z.string().min(8).max(500),
  sourceRunId: z.string().uuid().optional(),
  sourceFindingId: z.string().uuid().optional()
});

const CorrectionRejectSchema = z.object({
  reason: z.string().min(8).max(500)
});

analyticsCorrectionRoutes.get(
  "/admin/analytics/ledger-corrections",
  asyncRoute(async (req, res) => {
    const corrections = await listLedgerCorrections({
      businessId: req.tenantId,
      limit: Number(req.query?.limit || 50)
    });
    return res.json({ ok: true, corrections });
  })
);

analyticsCorrectionRoutes.post(
  "/admin/analytics/ledger-corrections",
  requireOwner,
  csrfProtect,
  asyncRoute(async (req, res) => {
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
      ua: req.get?.("user-agent") || null
    });

    return res.status(201).json(out);
  })
);

analyticsCorrectionRoutes.post(
  "/admin/analytics/ledger-corrections/:id/apply",
  requireOwner,
  csrfProtect,
  asyncRoute(async (req, res) => {
    const out = await applyLedgerCorrection({
      businessId: req.tenantId,
      correctionId: req.params.id,
      resolvedByStaffId: req.staff.id,
      ip: req.ip,
      ua: req.get?.("user-agent") || null
    });
    return res.json(out);
  })
);

analyticsCorrectionRoutes.post(
  "/admin/analytics/ledger-corrections/:id/reject",
  requireOwner,
  csrfProtect,
  asyncRoute(async (req, res) => {
    const v = validate(CorrectionRejectSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const out = await rejectLedgerCorrection({
      businessId: req.tenantId,
      correctionId: req.params.id,
      resolvedByStaffId: req.staff.id,
      reason: v.data.reason,
      ip: req.ip,
      ua: req.get?.("user-agent") || null
    });
    return res.json(out);
  })
);
