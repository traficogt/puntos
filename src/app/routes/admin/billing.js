import { dateTimeSchema } from "../../../utils/date-time-schema.js";
import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery } from "../../../utils/schemas.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { toCSV } from "../../../utils/csv.js";
import { div, fromMinor, sub, toMinor } from "../../../utils/money.js";
import { dbQuery } from "../../database.js";
import { BillingRepo } from "../../repositories/billing-repository.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */
/**
 * @template Q
 * @typedef {import("../_request-types.js").WithValidatedQuery<Q>} WithValidatedQuery
 */

export const adminBillingRoutes = Router();

const ivaQuerySchema = z.object({
  from: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTimeSchema()]).optional(),
  ),
  to: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTimeSchema()]).optional(),
  ),
});

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** @typedef {z.infer<typeof ivaQuerySchema>} IvaQuery */
/** @typedef {z.infer<typeof eventsQuerySchema>} EventsQuery */

/**
 * One day of gross sales; `monto_bruto_q` is NUMERIC and arrives as a string.
 * @typedef {{ fecha: Date, transacciones: number, monto_bruto_q: string }} IvaDayRow
 */

adminBillingRoutes.get(
  "/admin/billing/iva.csv",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(ivaQuerySchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedQuery<IvaQuery>} req @param {Response} res */
    async (req, res) => {
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
      /** @type {{ rows: IvaDayRow[] }} */
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
        params,
      );

      const csvRows = rows.map((r) => {
        // Prices include the 12% IVA: the taxable base is bruto / 1.12 rounded once
        // to the centavo and the tax is the remainder, so the three columns of
        // every row add up exactly.
        const gross = toMinor(r.monto_bruto_q);
        const net = div(gross, "1.12");
        const iva = sub(gross, net);
        return {
          fecha: r.fecha,
          transacciones: Number(r.transacciones || 0),
          monto_bruto_q: fromMinor(gross),
          base_sin_iva_q: fromMinor(net),
          iva_12_q: fromMinor(iva),
        };
      });

      const csv = toCSV(csvRows, [
        "fecha",
        "transacciones",
        "monto_bruto_q",
        "base_sin_iva_q",
        "iva_12_q",
      ]);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="reporte_iva_gt.csv"');
      return res.send(csv);
    },
  ),
);

adminBillingRoutes.get(
  "/admin/billing/events",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(eventsQuerySchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedQuery<EventsQuery>} req @param {Response} res */
    async (req, res) => {
      const { limit } = req.validatedQuery;
      const events = await BillingRepo.recentByBusiness(req.tenantId, limit);
      return res.json({ ok: true, events });
    },
  ),
);
