import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { dbQuery } from "../../database.js";

export const analyticsLedgerRoutes = Router();

analyticsLedgerRoutes.get(
  "/admin/analytics/ledger-reconciliation",
  asyncRoute(async (req, res) => {
    const businessId = req.tenantId;

    const { rows: latestRunRows } = await dbQuery(
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
         AND (
           business_id = $1
           OR business_id IS NULL
         )
       ORDER BY completed_at DESC
       LIMIT 1`,
      [businessId]
    );
    const latestRun = latestRunRows[0] ?? null;

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
         AND (
           business_id = $1
           OR business_id IS NULL
         )
       ORDER BY completed_at DESC
       LIMIT 10`,
      [businessId]
    );

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
           delta_points,
           delta_pending_points,
           delta_lifetime_points,
           repaired,
           created_at
         FROM ledger_reconciliation_findings
         WHERE run_id = $1
         ORDER BY ABS(delta_points) DESC, ABS(delta_lifetime_points) DESC, created_at DESC
         LIMIT 25`,
        [latestRun.id]
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
