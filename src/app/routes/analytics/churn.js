import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery, branchFilterQuerySchema } from "../../../utils/schemas.js";
import { AnalyticsRepository } from "../../repositories/analytics-repository.js";
import { resolveBranchFilter } from "./_util.js";
import { dbQuery } from "../../database.js";

export const analyticsChurnRoutes = Router();

analyticsChurnRoutes.get(
  "/admin/analytics/churn-risk",
  validateQuery(branchFilterQuerySchema.extend({
    threshold: z.coerce.number().min(0).max(1).default(0.7),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })),
  asyncRoute(async (req, res) => {
    const branchId = await resolveBranchFilter(req, res);
    if (branchId === "__invalid__") return;
    const { threshold, limit } = req.validatedQuery;

    let customers;
    if (!branchId) {
      customers = await AnalyticsRepository.getHighChurnRiskCustomers(req.tenantId, threshold, limit);
    } else {
      const { rows } = await dbQuery(
        `WITH branch_customers AS (
           SELECT DISTINCT customer_id
           FROM transactions
           WHERE business_id = $1
             AND branch_id = $2
         )
         SELECT
           c.id,
           c.name,
           c.phone,
           cl.churn_risk_score,
           cl.days_since_last_purchase,
           cl.total_spend,
           cl.total_visits,
           cl.last_purchase_at
         FROM customer_ltv cl
         JOIN customers c ON c.id = cl.customer_id
         JOIN branch_customers bc ON bc.customer_id = c.id
         WHERE c.business_id = $1
           AND c.deleted_at IS NULL
           AND cl.churn_risk_score >= $3
         ORDER BY cl.churn_risk_score DESC, cl.total_spend DESC
         LIMIT $4`,
        [req.tenantId, branchId, threshold, limit]
      );
      customers = rows;
    }

    return res.json({ ok: true, customers, threshold, branch_id: branchId, count: customers.length });
  })
);
