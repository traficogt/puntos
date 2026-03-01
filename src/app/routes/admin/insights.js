import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery, branchFilterQuerySchema } from "../../../utils/schemas.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { BranchRepo } from "../../repositories/branch-repository.js";
import { businessSummary } from "../../services/analytics-service.js";
import { dbQuery } from "../../database.js";

export const adminInsightsRoutes = Router();

adminInsightsRoutes.get(
  "/admin/analytics/summary",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(branchFilterQuerySchema),
  asyncRoute(async (req, res) => {
    const branchId = req.validatedQuery.branch_id ? String(req.validatedQuery.branch_id) : null;
    if (branchId) {
      const branch = await BranchRepo.getById(branchId);
      if (!branch || branch.business_id !== req.tenantId) {
        return res.status(400).json({ error: "Invalid branch_id" });
      }
    }
    const out = await businessSummary(req.tenantId, branchId);
    return res.json({ ok: true, ...out });
  })
);

adminInsightsRoutes.get(
  "/admin/roi",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(z.object({
    days: z.coerce.number().int().min(7).max(120).default(30)
  })),
  asyncRoute(async (req, res) => {
    const { days } = req.validatedQuery;
    const businessId = req.tenantId;

    const [curTx, prevTx, totals, redemptions] = await Promise.all([
      dbQuery(
        `SELECT COUNT(*)::int AS tx_count, COALESCE(SUM(amount_q),0)::numeric(10,2) AS revenue
         FROM transactions
         WHERE business_id = $1
           AND created_at >= now() - ($2 || ' days')::interval`,
        [businessId, String(days)]
      ),
      dbQuery(
        `SELECT COUNT(*)::int AS tx_count, COALESCE(SUM(amount_q),0)::numeric(10,2) AS revenue
         FROM transactions
         WHERE business_id = $1
           AND created_at >= now() - (($2 * 2) || ' days')::interval
           AND created_at < now() - ($2 || ' days')::interval`,
        [businessId, String(days)]
      ),
      dbQuery(
        `SELECT
           COUNT(*)::int AS customers_total,
           COUNT(*) FILTER (WHERE COALESCE(last_visit_at, created_at) >= now() - ($2 || ' days')::interval)::int AS customers_active
         FROM customers
         WHERE business_id = $1
           AND deleted_at IS NULL`,
        [businessId, String(days)]
      ),
      dbQuery(
        `SELECT COUNT(*)::int AS redemptions
         FROM redemptions
         WHERE business_id = $1
           AND created_at >= now() - ($2 || ' days')::interval`,
        [businessId, String(days)]
      )
    ]);

    const currRevenue = Number(curTx.rows?.[0]?.revenue ?? 0);
    const prevRevenue = Number(prevTx.rows?.[0]?.revenue ?? 0);
    const currTxCount = Number(curTx.rows?.[0]?.tx_count ?? 0);
    const prevTxCount = Number(prevTx.rows?.[0]?.tx_count ?? 0);
    const customersTotal = Number(totals.rows?.[0]?.customers_total ?? 0);
    const customersActive = Number(totals.rows?.[0]?.customers_active ?? 0);
    const redCount = Number(redemptions.rows?.[0]?.redemptions ?? 0);

    const revenueGrowthPct = prevRevenue > 0 ? ((currRevenue - prevRevenue) / prevRevenue) * 100 : null;
    const txGrowthPct = prevTxCount > 0 ? ((currTxCount - prevTxCount) / prevTxCount) * 100 : null;
    const repeatRatePct = customersTotal > 0 ? (customersActive / customersTotal) * 100 : 0;
    const redemptionRatePct = currTxCount > 0 ? (redCount / currTxCount) * 100 : 0;

    return res.json({
      ok: true,
      days,
      roi: {
        revenue_current_q: currRevenue,
        revenue_previous_q: prevRevenue,
        revenue_growth_pct: revenueGrowthPct,
        tx_current: currTxCount,
        tx_previous: prevTxCount,
        tx_growth_pct: txGrowthPct,
        customers_total: customersTotal,
        customers_active: customersActive,
        repeat_rate_pct: repeatRatePct,
        redemptions: redCount,
        redemption_rate_pct: redemptionRatePct
      }
    });
  })
);
