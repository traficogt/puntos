import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner } from "../../../middleware/auth.js";
import { dbQuery } from "../../database.js";

export const analyticsLedgerRoutes = Router();

// Owners see only whole-business runs and findings recorded for their own
// business. Runs without business_id are platform-wide operator checks whose
// totals and findings span every tenant; row-level security reserves them for
// platform administrators, and this query never requests them. Single-customer
// operator runs are excluded so they cannot stand in for the business total.
analyticsLedgerRoutes.get(
  "/admin/analytics/ledger-reconciliation",
  requireOwner,
  asyncRoute(async (req, res) => {
    const businessId = req.tenantId;

    const { rows: runRows } = await dbQuery(
      `SELECT
         id,
         started_at,
         completed_at,
         status,
         checked_customers,
         mismatched_customers,
         repaired_customers,
         scope
       FROM ledger_reconciliation_runs
       WHERE status = 'COMPLETED'
         AND scope = 'business'
         AND business_id = $1
       ORDER BY completed_at DESC
       LIMIT 10`,
      [businessId]
    );
    const latestRun = runRows[0] ?? null;

    let findingRows = [];
    if (latestRun?.id) {
      const findings = await dbQuery(
        `SELECT
           customer_id,
           business_id,
           stored_points,
           expected_points,
           stored_pending_points,
           expected_pending_points,
           stored_lifetime_points,
           expected_lifetime_points,
           (expected_points - stored_points) AS delta_points,
           (expected_pending_points - stored_pending_points) AS delta_pending_points,
           (expected_lifetime_points - stored_lifetime_points) AS delta_lifetime_points,
           repaired,
           created_at
         FROM ledger_reconciliation_findings
         WHERE run_id = $1
           AND business_id = $2
         ORDER BY ABS(expected_points - stored_points) DESC,
           ABS(expected_lifetime_points - stored_lifetime_points) DESC,
           created_at DESC
         LIMIT 25`,
        [latestRun.id, businessId]
      );
      findingRows = findings.rows;
    }

    return res.json({
      ok: true,
      latest_run: latestRun,
      recent_runs: runRows,
      latest_findings: findingRows
    });
  })
);
