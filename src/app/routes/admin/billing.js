import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery } from "../../../utils/schemas.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { toCSV } from "../../../utils/csv.js";
import { dbQuery } from "../../database.js";
import { BillingRepo } from "../../repositories/billing-repository.js";

export const adminBillingRoutes = Router();

adminBillingRoutes.get(
  "/admin/billing/iva.csv",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(z.object({
    from: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().datetime()]).optional()
    ),
    to: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().datetime()]).optional()
    )
  })),
  asyncRoute(async (req, res) => {
    const businessId = req.tenantId;
    const from = req.validatedQuery.from ? String(req.validatedQuery.from) : "";
    const to = req.validatedQuery.to ? String(req.validatedQuery.to) : "";
    const params = [businessId];
    let dateClause = "";
    if (from) {
      params.push(from);
      dateClause += ` AND t.created_at::date >= $${params.length}::date`;
    }
    if (to) {
      params.push(to);
      dateClause += ` AND t.created_at::date <= $${params.length}::date`;
    }
    const { rows } = await dbQuery(
      `SELECT
         t.created_at::date AS fecha,
         COUNT(*)::int AS transacciones,
         COALESCE(SUM(t.amount_q), 0)::numeric(10,2) AS monto_bruto_q
       FROM transactions t
       WHERE t.business_id = $1
         ${dateClause}
       GROUP BY t.created_at::date
       ORDER BY t.created_at::date ASC`,
      params
    );

    const csvRows = rows.map((r) => {
      const gross = Number(r.monto_bruto_q || 0);
      const net = gross / 1.12;
      const iva = gross - net;
      return {
        fecha: r.fecha,
        transacciones: Number(r.transacciones || 0),
        monto_bruto_q: gross.toFixed(2),
        base_sin_iva_q: net.toFixed(2),
        iva_12_q: iva.toFixed(2)
      };
    });

    const csv = toCSV(csvRows, ["fecha", "transacciones", "monto_bruto_q", "base_sin_iva_q", "iva_12_q"]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"reporte_iva_gt.csv\"");
    return res.send(csv);
  })
);

adminBillingRoutes.get(
  "/admin/billing/events",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100)
  })),
  asyncRoute(async (req, res) => {
    const { limit } = req.validatedQuery;
    const events = await BillingRepo.recentByBusiness(req.tenantId, limit);
    return res.json({ ok: true, events });
  })
);
