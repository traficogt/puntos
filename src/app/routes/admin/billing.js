import { dateTimeSchema } from '../../../utils/date-time-schema.js';
import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery } from "../../../utils/schemas.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { toCSV } from "../../../utils/csv.js";
import { dbQuery } from "../../database.js";
import { BillingRepo } from "../../repositories/billing-repository.js";
import { reportingPurchase } from "../../services/reporting-purchase.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { regionTimezone } from "../../services/regional-settings.js";

export const adminBillingRoutes = Router();

adminBillingRoutes.get(
  "/admin/billing/iva.csv",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(z.object({
    from: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTimeSchema()]).optional()
    ),
    to: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTimeSchema()]).optional()
    )
  })),
  asyncRoute(async (req, res) => {
    const businessId = req.tenantId;
    const from = req.validatedQuery.from ? String(req.validatedQuery.from) : "";
    const to = req.validatedQuery.to ? String(req.validatedQuery.to) : "";
    // Sale days follow the business's own calendar, not the database server's
    // timezone, so businesses configured outside Guatemala get correct days.
    const business = await BusinessRepo.getById(businessId);
    const params = [businessId, regionTimezone(business)];
    const localDate = "(t.created_at AT TIME ZONE $2)::date";
    let dateClause = "";
    if (from) {
      params.push(from);
      dateClause += ` AND ${localDate} >= $${params.length}::date`;
    }
    if (to) {
      params.push(to);
      dateClause += ` AND ${localDate} <= $${params.length}::date`;
    }
    // Only recorded sales: no redemptions, expiries, opening balances, bonuses or refunded sales.
    // Unbounded numeric: currencies such as COP exceed numeric(10,2) totals.
    const { rows } = await dbQuery(
      `SELECT
         to_char(${localDate}, 'YYYY-MM-DD') AS fecha,
         COUNT(*)::int AS transacciones,
         ROUND(COALESCE(SUM(t.amount_q), 0), 2) AS monto_bruto_q
       FROM transactions t
       WHERE t.business_id = $1
         AND ${reportingPurchase("t")}
         ${dateClause}
       GROUP BY 1
       ORDER BY 1 ASC`,
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
