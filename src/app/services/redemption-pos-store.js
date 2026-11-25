import { randomUUID } from "node:crypto";
import { forbidden, notFound, conflict } from "../../utils/http-error.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";

/**
 * pg client inside a transaction (pg ships no types; this mirrors QueryResult<any>).
 * @typedef {import("../../types/db.js").DbQueryClient} RedemptionPosQueryClient
 *
 * The staff session as the routes attach it (the staff row belongs to the repositories
 * owner). fulfillmentActor() re-reads and verifies the account, so the session fields are
 * only hints here and may be absent.
 * @typedef {{
 *   id?: string | null,
 *   business_id?: string | null,
 *   branch_id?: string | null,
 *   role?: string | null,
 *   impersonated_by?: string | null
 * }} RedemptionPosStaff
 *
 * staff_users fields fulfillmentActor() verifies.
 * @typedef {{ id: string, business_id: string, role: string, branch_id: string | null, active: boolean }} RedemptionPosStaffRow
 * @typedef {RedemptionPosStaffRow & { impersonated_by?: string }} RedemptionPosActor
 *
 * A redemptions row joined with its reward name, the business currency and the
 * restoration flag (the ledger rows belong to the repositories owner).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   customer_id: string,
 *   reward_id: string,
 *   branch_id: string | null,
 *   code: string,
 *   points_cost: number,
 *   status: string,
 *   reward_name: string,
 *   currency: string,
 *   points_restored: boolean
 * }} RedemptionPosRedemptionRow
 * @typedef {RedemptionPosRedemptionRow & { debit_corrected: boolean }} RedemptionPosRedemption
 *
 * A reward_pos_mappings row (2026-11-11-z-pos-fulfillment.sql); quantity is NUMERIC, so pg
 * returns a string until publicMapping() converts it.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   reward_id: string,
 *   branch_id: string | null,
 *   source: string,
 *   product_ref: string,
 *   item_name: string,
 *   item_kind: string,
 *   quantity: string | number,
 *   enabled: boolean,
 *   inventory_required: boolean,
 *   version: number,
 *   created_at: Date | string,
 *   updated_at: Date | string
 * }} RedemptionPosMappingRow
 * @typedef {Omit<RedemptionPosMappingRow, "quantity"> & { quantity: number }} RedemptionPosMapping
 *
 * A redemption_pos_records row; returned_quantity is NUMERIC (string from pg).
 * @typedef {{
 *   redemption_id: string,
 *   business_id: string,
 *   branch_id: string | null,
 *   reward_id: string,
 *   reward_name: string,
 *   currency: string,
 *   status: string,
 *   method: string | null,
 *   version: number,
 *   source: string | null,
 *   order_id: string | null,
 *   line_id: string | null,
 *   original_event_id: string | null,
 *   mapping_snapshot: RedemptionPosMapping | null,
 *   stock_status: string,
 *   returned_quantity: string | number,
 *   receipt_ref: string | null,
 *   recorded_at: Date | string | null,
 *   created_at: Date | string,
 *   updated_at: Date | string
 * }} RedemptionPosRecord
 */

/**
 * @param {RedemptionPosQueryClient} client
 * @param {string} businessId
 * @param {RedemptionPosStaff | null | undefined} staff
 * @param {boolean} [ownerOnly]
 * @returns {Promise<RedemptionPosActor>}
 */
export async function fulfillmentActor(client, businessId, staff, ownerOnly = false) {
  /** @type {RedemptionPosStaffRow | undefined} */
  const row = (
    await client.query(
      "SELECT id,business_id,role,branch_id,active FROM staff_users WHERE business_id=$1 AND id=$2",
      [businessId, staff?.id],
    )
  ).rows[0];
  if (
    !row?.active ||
    staff?.business_id !== businessId ||
    !["OWNER", "MANAGER", "CASHIER"].includes(row.role) ||
    (row.branch_id ?? null) !== (staff.branch_id ?? null) ||
    (ownerOnly && row.role !== "OWNER")
  )
    throw forbidden("La sesión no puede administrar estos registros.");
  return { ...row, ...(staff.impersonated_by ? { impersonated_by: staff.impersonated_by } : {}) };
}
/**
 * @param {{ role: string, branch_id?: string | null }} staff
 * @param {{ branch_id?: string | null }} row
 */
export const canSeeFulfillment = (staff, row) =>
  staff.role === "OWNER" || (staff.branch_id ?? null) === (row.branch_id ?? null);
/**
 * @param {RedemptionPosQueryClient} client
 * @param {string} businessId
 * @param {string} source
 * @param {string} eventId
 */
export async function lockFulfillmentRequest(client, businessId, source, eventId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
    businessId,
    `fulfillment:${source}:${eventId}`,
  ]);
}
/**
 * @param {RedemptionPosQueryClient} client
 * @param {string} businessId
 * @param {string} redemptionId
 * @param {{ lock?: boolean, requireUnrestored?: boolean }} [options]
 * @returns {Promise<RedemptionPosRedemption>}
 */
export async function redemptionEvidence(
  client,
  businessId,
  redemptionId,
  { lock = false, requireUnrestored = false } = {},
) {
  redemptionId = String(redemptionId).toLowerCase();
  // Use the original debit as the shared serialization point with point restoration.
  const debits = await client.query(
    `SELECT id,reversed_transaction_id,status FROM transactions WHERE business_id=$1 AND source='redeem' AND meta->>'redemption_id'=$2${lock ? " FOR UPDATE" : ""}`,
    [businessId, redemptionId],
  );
  /** @type {RedemptionPosRedemptionRow | undefined} */
  const row = (
    await client.query(
      `SELECT r.*,w.name AS reward_name,COALESCE(b.program_json#>>'{region,currency}','GTQ') AS currency,
 EXISTS(SELECT 1 FROM service_redemption_restorations s WHERE s.business_id=r.business_id AND s.redemption_id=r.id) AS points_restored
 FROM redemptions r JOIN rewards w ON w.id=r.reward_id AND w.business_id=r.business_id JOIN businesses b ON b.id=r.business_id
 WHERE r.business_id=$1 AND r.id=$2`,
      [businessId, redemptionId],
    )
  ).rows[0];
  if (!row || row.status !== "REDEEMED") throw notFound("Canje completado no encontrado.");
  if (
    requireUnrestored &&
    (row.points_restored ||
      debits.rows.some((d) => d.reversed_transaction_id || d.status !== "POSTED"))
  )
    throw conflict(
      "Este canje tiene una restitución o corrección; requiere revisión antes de vincular otra entrega.",
    );
  return {
    ...row,
    debit_corrected: debits.rows.some((d) => d.reversed_transaction_id || d.status !== "POSTED"),
  };
}
/**
 * @param {RedemptionPosQueryClient} client
 * @param {Pick<RedemptionPosRedemptionRow, "id" | "business_id" | "branch_id" | "reward_id" | "reward_name" | "currency">} redemption
 * @returns {Promise<RedemptionPosRecord>}
 */
export async function ensureFulfillmentRecord(client, redemption) {
  await client.query(
    `INSERT INTO redemption_pos_records(redemption_id,business_id,branch_id,reward_id,reward_name,currency)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(redemption_id) DO NOTHING`,
    [
      redemption.id,
      redemption.business_id,
      redemption.branch_id,
      redemption.reward_id,
      redemption.reward_name,
      redemption.currency,
    ],
  );
  return (
    await client.query(
      "SELECT * FROM redemption_pos_records WHERE business_id=$1 AND redemption_id=$2 FOR UPDATE",
      [redemption.business_id, redemption.id],
    )
  ).rows[0];
}
/**
 * @param {RedemptionPosQueryClient} client
 * @param {{ id: string | null, business_id: string, impersonated_by?: string | null }} staff
 * @param {string} action
 * @param {Record<string, unknown>} meta
 */
export async function fulfillmentAudit(client, staff, action, meta) {
  await client.query(
    "INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      staff.business_id,
      "STAFF",
      staff.id,
      action,
      JSON.stringify(withImpersonationMeta(meta, staff)),
    ],
  );
}
/**
 * @param {RedemptionPosMappingRow} row
 * @returns {RedemptionPosMapping}
 */
export const publicMapping = (row) => ({ ...row, quantity: Number(row.quantity) });
/** @param {RedemptionPosRecord | null | undefined} row */
export function publicFulfillment(row) {
  if (!row) return null;
  return {
    redemptionId: row.redemption_id,
    eventId: row.original_event_id,
    source: row.source,
    orderId: row.order_id,
    lineId: row.line_id,
    status: row.status,
    stockStatus: row.stock_status,
    method: row.method,
    version: row.version,
    receiptRef: row.receipt_ref,
    returnedQuantity: Number(row.returned_quantity),
    recordedAt: row.recorded_at,
    mapping: row.mapping_snapshot,
  };
}
