import crypto from "node:crypto";

import { dbQuery, withTransaction } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { buildLedgerFinding, isLedgerBalanceMismatch } from "./ledger-reconciliation-service.js";

function id() {
  return crypto.randomUUID();
}

/**
 * @typedef {{
 *   withTransaction: <T>(fn: (client: { query: (...args: any[]) => Promise<any> }) => Promise<T>) => Promise<T>,
 *   AuditRepo: { log: (...args: any[]) => Promise<unknown> },
 *   readCustomerLedgerRow: (query: (...args: any[]) => Promise<any>, customerId: string) => Promise<any>,
 *   applyBalanceAdjustment: (client: { query: (...args: any[]) => Promise<any> }, correctionId: string, requestedByStaffId: string, reason: string, finding: Record<string, any>) => Promise<string>
 * }} LedgerCorrectionDeps
 *
 * @typedef {{
 *   businessId: string,
 *   customerId: string,
 *   requestedByStaffId: string,
 *   reason: string,
 *   ip?: string | null,
 *   ua?: string | null,
 *   sourceRunId?: string | null,
 *   sourceFindingId?: string | null
 * }} RequestLedgerCorrectionInput
 *
 * @typedef {{
 *   businessId: string,
 *   correctionId: string,
 *   resolvedByStaffId: string,
 *   ip?: string | null,
 *   ua?: string | null
 * }} ResolveLedgerCorrectionInput
 *
 * @typedef {{
 *   businessId: string,
 *   correctionId: string,
 *   resolvedByStaffId: string,
 *   reason: string,
 *   ip?: string | null,
 *   ua?: string | null
 * }} RejectLedgerCorrectionInput
 */

function normalizeReason(reason) {
  const value = String(reason || "").trim();
  if (value.length < 8) throw badRequest("Reason is required");
  if (value.length > 500) throw badRequest("Reason too long");
  return value;
}

async function readCustomerLedgerRow(query, customerId) {
  const { rows } = await query(
    `WITH tx_agg AS (
       SELECT
         customer_id,
         COALESCE(SUM(CASE WHEN status = 'POSTED' THEN points ELSE 0 END), 0)::int AS posted_points,
         COALESCE(SUM(CASE WHEN status = 'PENDING' THEN points ELSE 0 END), 0)::int AS pending_points,
         COALESCE(SUM(CASE WHEN status = 'POSTED' AND points > 0 THEN points ELSE 0 END), 0)::int AS lifetime_points
       FROM transactions
       WHERE customer_id = $1
       GROUP BY customer_id
     ),
     adj_agg AS (
       SELECT
         customer_id,
         COALESCE(SUM(delta_points), 0)::int AS delta_points,
         COALESCE(SUM(delta_pending_points), 0)::int AS delta_pending_points,
         COALESCE(SUM(delta_lifetime_points), 0)::int AS delta_lifetime_points
       FROM ledger_balance_adjustments
       WHERE customer_id = $1
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
     WHERE c.id = $1
       AND c.deleted_at IS NULL`,
    [customerId]
  );
  return rows[0] ?? null;
}

async function applyBalanceAdjustment(client, correctionId, requestedByStaffId, reason, finding) {
  const adjustmentId = id();
  await client.query(
    `INSERT INTO ledger_balance_adjustments
     (id, correction_id, business_id, customer_id, created_by_staff_id, reason,
      delta_points, delta_pending_points, delta_lifetime_points)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      adjustmentId,
      correctionId,
      finding.business_id,
      finding.customer_id,
      requestedByStaffId,
      reason,
      finding.delta_points,
      finding.delta_pending_points,
      finding.delta_lifetime_points
    ]
  );
  await client.query(
    `UPDATE customer_balances
     SET points = points + $2,
         pending_points = pending_points + $3,
         lifetime_points = lifetime_points + $4,
         updated_at = now()
     WHERE customer_id = $1`,
    [
      finding.customer_id,
      finding.delta_points,
      finding.delta_pending_points,
      finding.delta_lifetime_points
    ]
  );
  return adjustmentId;
}

function buildResolutionMeta(finding) {
  return {
    stored_points: finding.stored_points,
    expected_points: finding.expected_points,
    stored_pending_points: finding.stored_pending_points,
    expected_pending_points: finding.expected_pending_points,
    stored_lifetime_points: finding.stored_lifetime_points,
    expected_lifetime_points: finding.expected_lifetime_points,
    delta_points: finding.delta_points,
    delta_pending_points: finding.delta_pending_points,
    delta_lifetime_points: finding.delta_lifetime_points,
    strategy: "LEDGER_BALANCE_ADJUSTMENT"
  };
}

/**
 * @param {LedgerCorrectionDeps} deps
 * @param {RequestLedgerCorrectionInput} args
 */
export async function requestLedgerCorrectionWithDeps(deps, {
  businessId,
  customerId,
  requestedByStaffId,
  reason,
  ip = null,
  ua = null,
  sourceRunId = null,
  sourceFindingId = null
}) {
  const normalizedReason = normalizeReason(reason);

  return deps.withTransaction(async (client) => {
    const row = await deps.readCustomerLedgerRow(client.query.bind(client), customerId);
    if (!row || String(row.business_id) !== String(businessId)) {
      throw notFound("Customer not found");
    }

    if (!isLedgerBalanceMismatch(row)) {
      throw conflict("Customer balance already matches the ledger");
    }

    const finding = buildLedgerFinding(row);
    const correctionId = id();
    await client.query(
      `INSERT INTO ledger_balance_corrections
       (id, business_id, customer_id, status, requested_by_staff_id, reason,
        source_run_id, source_finding_id,
        requested_stored_points, requested_expected_points,
        requested_stored_pending_points, requested_expected_pending_points,
        requested_stored_lifetime_points, requested_expected_lifetime_points)
       VALUES ($1,$2,$3,'PENDING',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        correctionId,
        businessId,
        customerId,
        requestedByStaffId,
        normalizedReason,
        sourceRunId,
        sourceFindingId,
        finding.stored_points,
        finding.expected_points,
        finding.stored_pending_points,
        finding.expected_pending_points,
        finding.stored_lifetime_points,
        finding.expected_lifetime_points
      ]
    );

    await deps.AuditRepo.log({
      id: id(),
      business_id: businessId,
      actor_type: "STAFF",
      actor_id: requestedByStaffId,
      action: "ledger.correction.requested",
      ip,
      ua,
      meta: {
        correction_id: correctionId,
        customer_id: customerId,
        ...buildResolutionMeta(finding),
        reason: normalizedReason
      }
    });

    return {
      ok: true,
      correction: {
        id: correctionId,
        status: "PENDING",
        customer_id: customerId,
        requested_by_staff_id: requestedByStaffId,
        reason: normalizedReason,
        ...buildResolutionMeta(finding)
      }
    };
  });
}

/**
 * @param {LedgerCorrectionDeps} deps
 * @param {ResolveLedgerCorrectionInput} args
 */
export async function applyLedgerCorrectionWithDeps(deps, {
  businessId,
  correctionId,
  resolvedByStaffId,
  ip = null,
  ua = null
}) {
  return deps.withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT *
       FROM ledger_balance_corrections
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [correctionId, businessId]
    );
    const correction = rows[0];
    if (!correction) throw notFound("Ledger correction not found");
    if (correction.status !== "PENDING") throw conflict("Ledger correction is already resolved");
    if (String(correction.requested_by_staff_id || "") === String(resolvedByStaffId)) {
      throw forbidden("A different owner must apply the correction");
    }

    const row = await deps.readCustomerLedgerRow(client.query.bind(client), correction.customer_id);
    if (!row || String(row.business_id) !== String(businessId)) {
      throw notFound("Customer not found");
    }

    const finding = buildLedgerFinding(row);
    if (!isLedgerBalanceMismatch(row)) {
      throw conflict("Customer balance already matches the ledger");
    }

    const adjustmentId = await deps.applyBalanceAdjustment(
      client,
      correctionId,
      resolvedByStaffId,
      correction.reason,
      finding
    );
    await client.query(
      `UPDATE ledger_balance_corrections
       SET status = 'APPLIED',
           resolved_by_staff_id = $2,
           resolved_at = now(),
           resolution_meta = $3::jsonb
       WHERE id = $1`,
      [
        correctionId,
        resolvedByStaffId,
        JSON.stringify({
          adjustment_id: adjustmentId,
          ...buildResolutionMeta(finding)
        })
      ]
    );

    await deps.AuditRepo.log({
      id: id(),
      business_id: businessId,
      actor_type: "STAFF",
      actor_id: resolvedByStaffId,
      action: "ledger.correction.applied",
      ip,
      ua,
      meta: {
        correction_id: correctionId,
        adjustment_id: adjustmentId,
        customer_id: correction.customer_id,
        requested_by_staff_id: correction.requested_by_staff_id,
        ...buildResolutionMeta(finding)
      }
    });

    return {
      ok: true,
      correction: {
        id: correctionId,
        status: "APPLIED",
        customer_id: correction.customer_id,
        resolved_by_staff_id: resolvedByStaffId,
        adjustment_id: adjustmentId,
        ...buildResolutionMeta(finding)
      }
    };
  });
}

/**
 * @param {LedgerCorrectionDeps} deps
 * @param {RejectLedgerCorrectionInput} args
 */
export async function rejectLedgerCorrectionWithDeps(deps, {
  businessId,
  correctionId,
  resolvedByStaffId,
  reason,
  ip = null,
  ua = null
}) {
  const normalizedReason = normalizeReason(reason);

  return deps.withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT *
       FROM ledger_balance_corrections
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [correctionId, businessId]
    );
    const correction = rows[0];
    if (!correction) throw notFound("Ledger correction not found");
    if (correction.status !== "PENDING") throw conflict("Ledger correction is already resolved");
    if (String(correction.requested_by_staff_id || "") === String(resolvedByStaffId)) {
      throw forbidden("A different owner must reject the correction");
    }

    await client.query(
      `UPDATE ledger_balance_corrections
       SET status = 'REJECTED',
           resolved_by_staff_id = $2,
           resolved_at = now(),
           resolution_meta = $3::jsonb
       WHERE id = $1`,
      [correctionId, resolvedByStaffId, JSON.stringify({ reason: normalizedReason })]
    );

    await deps.AuditRepo.log({
      id: id(),
      business_id: businessId,
      actor_type: "STAFF",
      actor_id: resolvedByStaffId,
      action: "ledger.correction.rejected",
      ip,
      ua,
      meta: {
        correction_id: correctionId,
        customer_id: correction.customer_id,
        requested_by_staff_id: correction.requested_by_staff_id,
        reason: normalizedReason
      }
    });

    return {
      ok: true,
      correction: {
        id: correctionId,
        status: "REJECTED",
        customer_id: correction.customer_id,
        resolved_by_staff_id: resolvedByStaffId,
        reason: normalizedReason
      }
    };
  });
}

const correctionDeps = {
  withTransaction,
  AuditRepo,
  readCustomerLedgerRow,
  applyBalanceAdjustment
};

/**
 * @param {RequestLedgerCorrectionInput} args
 */
export async function requestLedgerCorrection(args) {
  return requestLedgerCorrectionWithDeps(correctionDeps, args);
}

/**
 * @param {ResolveLedgerCorrectionInput} args
 */
export async function applyLedgerCorrection(args) {
  return applyLedgerCorrectionWithDeps(correctionDeps, args);
}

/**
 * @param {RejectLedgerCorrectionInput} args
 */
export async function rejectLedgerCorrection(args) {
  return rejectLedgerCorrectionWithDeps(correctionDeps, args);
}

/**
 * @param {{ businessId?: string, limit?: number }} [args]
 */
export async function listLedgerCorrections({ businessId = "", limit = 50 } = {}) {
  const cappedLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 0) || 50));
  const { rows } = await dbQuery(
    `SELECT
       id,
       business_id,
       customer_id,
       status,
       requested_by_staff_id,
       resolved_by_staff_id,
       reason,
       source_run_id,
       source_finding_id,
       requested_stored_points,
       requested_expected_points,
       requested_stored_pending_points,
       requested_expected_pending_points,
       requested_stored_lifetime_points,
       requested_expected_lifetime_points,
       resolution_meta,
       created_at,
       resolved_at
     FROM ledger_balance_corrections
     WHERE business_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [businessId, cappedLimit]
  );
  return rows;
}
