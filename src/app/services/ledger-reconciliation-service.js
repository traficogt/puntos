import crypto from "node:crypto";
import { dbQuery, withTransaction } from "../database.js";

function id() {
  return crypto.randomUUID();
}

function toInt(value) {
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

function normalizeLimit(limit) {
  return Math.max(1, Math.min(50_000, Math.floor(Number(limit) || 0) || 5_000));
}

function reconciliationScope({ businessId = null, customerId = null }) {
  if (customerId) return "customer";
  if (businessId) return "business";
  return "all";
}

export function expectedLedgerBalances(row) {
  return {
    points: toInt(row?.expected_points),
    pending_points: toInt(row?.expected_pending_points),
    lifetime_points: toInt(row?.expected_lifetime_points)
  };
}

export function isLedgerBalanceMismatch(row) {
  const expected = expectedLedgerBalances(row);
  return expected.points !== toInt(row?.stored_points)
    || expected.pending_points !== toInt(row?.stored_pending_points)
    || expected.lifetime_points !== toInt(row?.stored_lifetime_points);
}

export function buildLedgerFinding(row) {
  const expected = expectedLedgerBalances(row);
  const stored = {
    points: toInt(row?.stored_points),
    pending_points: toInt(row?.stored_pending_points),
    lifetime_points: toInt(row?.stored_lifetime_points)
  };

  return {
    customer_id: String(row.customer_id),
    business_id: String(row.business_id),
    stored_points: stored.points,
    expected_points: expected.points,
    stored_pending_points: stored.pending_points,
    expected_pending_points: expected.pending_points,
    stored_lifetime_points: stored.lifetime_points,
    expected_lifetime_points: expected.lifetime_points,
    delta_points: expected.points - stored.points,
    delta_pending_points: expected.pending_points - stored.pending_points,
    delta_lifetime_points: expected.lifetime_points - stored.lifetime_points
  };
}

async function readLedgerRows(query, { businessId = null, customerId = null, limit = 5_000 } = {}) {
  const cappedLimit = normalizeLimit(limit);
  const countResult = await query(
    `SELECT COUNT(*)::int AS count
     FROM customers
     WHERE ($1::uuid IS NULL OR business_id = $1)
       AND ($2::uuid IS NULL OR id = $2)`,
    [businessId, customerId]
  );
  const checkedCustomers = toInt(countResult.rows?.[0]?.count);

  const rowsResult = await query(
    `WITH tx_agg AS (
       SELECT
         customer_id,
         COALESCE(SUM(CASE WHEN status = 'POSTED' THEN points ELSE 0 END), 0)::int AS posted_points,
         COALESCE(SUM(CASE WHEN status = 'PENDING' THEN points ELSE 0 END), 0)::int AS pending_points,
         COALESCE(SUM(CASE WHEN status = 'POSTED' AND points > 0 THEN points ELSE 0 END), 0)::int AS lifetime_points
       FROM transactions
       GROUP BY customer_id
     ),
     adj_agg AS (
       SELECT
         customer_id,
         COALESCE(SUM(delta_points), 0)::int AS delta_points,
         COALESCE(SUM(delta_pending_points), 0)::int AS delta_pending_points,
         COALESCE(SUM(delta_lifetime_points), 0)::int AS delta_lifetime_points
       FROM ledger_balance_adjustments
       GROUP BY customer_id
     )
     SELECT
       c.id AS customer_id,
       c.business_id,
       COALESCE(cb.points, 0)::int AS stored_points,
       COALESCE(cb.pending_points, 0)::int AS stored_pending_points,
       COALESCE(cb.lifetime_points, 0)::int AS stored_lifetime_points,
       (COALESCE(tx.posted_points, 0) + COALESCE(adj.delta_points, 0))::int AS expected_points,
       (COALESCE(tx.pending_points, 0) + COALESCE(adj.delta_pending_points, 0))::int AS expected_pending_points,
       (COALESCE(tx.lifetime_points, 0) + COALESCE(adj.delta_lifetime_points, 0))::int AS expected_lifetime_points
     FROM customers c
     LEFT JOIN customer_balances cb ON cb.customer_id = c.id
     LEFT JOIN tx_agg tx ON tx.customer_id = c.id
     LEFT JOIN adj_agg adj ON adj.customer_id = c.id
     WHERE ($1::uuid IS NULL OR c.business_id = $1)
       AND ($2::uuid IS NULL OR c.id = $2)
     ORDER BY c.created_at ASC, c.id ASC
     LIMIT $3`,
    [businessId, customerId, cappedLimit]
  );

  return {
    checkedCustomers,
    rows: rowsResult.rows || [],
    hasMore: checkedCustomers > cappedLimit,
    limit: cappedLimit
  };
}

async function insertRun({ businessId = null, customerId = null, repair = false, limit = 5_000 } = {}) {
  const runId = id();
  const scope = reconciliationScope({ businessId, customerId });
  await dbQuery(
    `INSERT INTO ledger_reconciliation_runs
     (id, scope, status, business_id, customer_id, meta)
     VALUES ($1, $2, 'RUNNING', $3, $4, $5)`,
    [
      runId,
      scope,
      businessId,
      customerId,
      {
        repair,
        limit: normalizeLimit(limit)
      }
    ]
  );
  return runId;
}

async function markRunCompleted(client, runId, summary) {
  await client.query(
    `UPDATE ledger_reconciliation_runs
     SET status = 'COMPLETED',
         checked_customers = $2,
         mismatched_customers = $3,
         repaired_customers = $4,
         completed_at = now(),
         meta = COALESCE(meta, '{}'::jsonb) || $5::jsonb
     WHERE id = $1`,
    [
      runId,
      summary.checkedCustomers,
      summary.mismatchedCustomers,
      summary.repairedCustomers,
      JSON.stringify({
        truncated: summary.hasMore,
        limit: summary.limit
      })
    ]
  );
}

async function markRunFailed(runId, error) {
  await dbQuery(
    `UPDATE ledger_reconciliation_runs
     SET status = 'FAILED',
         completed_at = now(),
         meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [
      runId,
      JSON.stringify({
        error: error?.message || String(error)
      })
    ]
  );
}

async function recordFinding(client, runId, finding, repaired) {
  await client.query(
    `INSERT INTO ledger_reconciliation_findings
     (id, run_id, business_id, customer_id, stored_points, expected_points,
      stored_pending_points, expected_pending_points, stored_lifetime_points,
      expected_lifetime_points, repaired)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id(),
      runId,
      finding.business_id,
      finding.customer_id,
      finding.stored_points,
      finding.expected_points,
      finding.stored_pending_points,
      finding.expected_pending_points,
      finding.stored_lifetime_points,
      finding.expected_lifetime_points,
      repaired
    ]
  );
}

async function repairBalance(client, finding) {
  await client.query(
    `INSERT INTO customer_balances
     (customer_id, points, pending_points, lifetime_points, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (customer_id)
     DO UPDATE SET
       points = EXCLUDED.points,
       pending_points = EXCLUDED.pending_points,
       lifetime_points = EXCLUDED.lifetime_points,
       updated_at = now()`,
    [
      finding.customer_id,
      finding.expected_points,
      finding.expected_pending_points,
      finding.expected_lifetime_points
    ]
  );
}

export async function runLedgerReconciliation({
  businessId = null,
  customerId = null,
  limit = 5_000,
  repair = false,
  persist = true
} = {}) {
  const normalizedLimit = normalizeLimit(limit);
  const runId = persist ? await insertRun({ businessId, customerId, repair, limit: normalizedLimit }) : null;

  try {
    return await withTransaction(async (client) => {
      const report = await readLedgerRows(client.query.bind(client), {
        businessId,
        customerId,
        limit: normalizedLimit
      });

      const findings = report.rows
        .filter(isLedgerBalanceMismatch)
        .map(buildLedgerFinding);

      let repairedCustomers = 0;
      for (const finding of findings) {
        let repaired = false;
        if (repair) {
          await repairBalance(client, finding);
          repaired = true;
          repairedCustomers += 1;
        }
        if (runId) {
          await recordFinding(client, runId, finding, repaired);
        }
      }

      const summary = {
        runId,
        scope: reconciliationScope({ businessId, customerId }),
        checkedCustomers: report.checkedCustomers,
        mismatchedCustomers: findings.length,
        repairedCustomers,
        hasMore: report.hasMore,
        limit: report.limit,
        findings
      };

      if (runId) {
        await markRunCompleted(client, runId, summary);
      }

      return summary;
    });
  } catch (error) {
    if (runId) {
      await markRunFailed(runId, error).catch(() => {});
    }
    throw error;
  }
}
