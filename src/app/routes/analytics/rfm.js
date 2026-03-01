import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { dbQuery } from "../../database.js";

export const analyticsRfmRoutes = Router();

analyticsRfmRoutes.get(
  "/admin/analytics/rfm",
  asyncRoute(async (req, res) => {
    const { rows } = await dbQuery(
      `SELECT
         rfm_score,
         COUNT(*) AS customer_count,
         AVG(total_spend) AS avg_spend,
         AVG(total_visits) AS avg_visits
       FROM customer_ltv cl
       JOIN customers c ON c.id = cl.customer_id
       WHERE c.business_id = $1
         AND c.deleted_at IS NULL
       GROUP BY rfm_score
       ORDER BY rfm_score DESC`,
      [req.tenantId]
    );

    return res.json({ ok: true, distribution: rows });
  })
);

