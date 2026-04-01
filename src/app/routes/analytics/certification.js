import { Router } from "express";
import { z } from "zod";

import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner } from "../../../middleware/auth.js";
import { validateQuery } from "../../../utils/schemas.js";
import {
  ledgerCertificationCsv,
  readLedgerCertificationArtifact,
  readLedgerCertificationArchiveIndex,
  readLedgerCertificationReport,
  resolveCertificationPeriod
} from "../../services/ledger-certification-service.js";

export const analyticsCertificationRoutes = Router();

const certificationQuerySchema = z.object({
  from: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  ),
  to: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  )
});

const certificationArchiveDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

analyticsCertificationRoutes.get(
  "/admin/analytics/ledger-certification/archive",
  requireOwner,
  asyncRoute(async (req, res) => {
    const archive = readLedgerCertificationArchiveIndex({ businessId: req.tenantId });
    return res.json({
      ok: true,
      ...archive,
      available_days: archive.available_days.map((day) => ({
        ...day,
        json_url: `/api/admin/analytics/ledger-certification/archive/${encodeURIComponent(day.date)}`,
        csv_url: `/api/admin/analytics/ledger-certification/archive/${encodeURIComponent(day.date)}.csv`
      }))
    });
  })
);

analyticsCertificationRoutes.get(
  "/admin/analytics/ledger-certification/archive/:date.csv",
  requireOwner,
  asyncRoute(async (req, res) => {
    const { date } = certificationArchiveDateSchema.parse({ date: req.params.date });
    const artifact = readLedgerCertificationArtifact({
      businessId: req.tenantId,
      date,
      format: "csv"
    });
    if (!artifact) return res.status(404).json({ error: "not_found" });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
    return res.send(artifact.content);
  })
);

analyticsCertificationRoutes.get(
  "/admin/analytics/ledger-certification/archive/:date",
  requireOwner,
  asyncRoute(async (req, res) => {
    const { date } = certificationArchiveDateSchema.parse(req.params);
    const artifact = readLedgerCertificationArtifact({
      businessId: req.tenantId,
      date,
      format: "json"
    });
    if (!artifact) return res.status(404).json({ error: "not_found" });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
    return res.send(artifact.content);
  })
);

analyticsCertificationRoutes.get(
  "/admin/analytics/ledger-certification",
  requireOwner,
  validateQuery(certificationQuerySchema),
  asyncRoute(async (req, res) => {
    const { from, to } = resolveCertificationPeriod(req.validatedQuery);
    const report = await readLedgerCertificationReport(req.tenantId, from, to);
    return res.json(report);
  })
);

analyticsCertificationRoutes.get(
  "/admin/analytics/ledger-certification.csv",
  requireOwner,
  validateQuery(certificationQuerySchema),
  asyncRoute(async (req, res) => {
    const { from, to } = resolveCertificationPeriod(req.validatedQuery);
    const report = await readLedgerCertificationReport(req.tenantId, from, to);
    const csv = ledgerCertificationCsv(report);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ledger-certification-${report.period.from}_to_${report.period.to}.csv"`);
    return res.send(csv);
  })
);
