import { conflict } from "../../utils/http-error.js";
import { completeLegacyProtectedRedemption } from "./reward-promise-service.js";
import { enqueueWebhookEvent } from "./webhook-service.js";

/**
 * pg client inside a transaction (pg ships no types; this mirrors QueryResult<any>).
 * @typedef {import("../../types/db.js").DbQueryClient} PosCheckoutQueryClient
 *
 * What the POS receives when a cart line is authorized (stored as authorization_snapshot).
 * @typedef {{
 *   redemption: { id: string, code: string, points_cost: number, balance_after: number },
 *   mapping: import("./redemption-pos-store.js").RedemptionPosMapping
 * }} PosCheckoutAuthorizationSnapshot
 *
 * What redeemReward hands its completion hook (the completeLegacyProtectedRedemption
 * contract; `reward` is the rewards row, so checkout also reads its stock). Checkout
 * stores it as completion_payload and replays it once the paid receipt arrives.
 * @typedef {{
 *   businessId: string,
 *   staff: import("./reward-promise-service.js").RewardPromiseStaff,
 *   customerId: string,
 *   redemptionId: string,
 *   reward: { id: string, name?: string | null, stock?: number | null, promise_id?: string | null },
 *   pointsCost: number,
 *   requestId?: string | null,
 *   cycleId?: string | null
 * }} PosCheckoutCompletionPayload
 *
 * A pos_checkout_intents row (2026-11-11-zz-pos-checkout.sql). The table CHECK keeps the
 * customer, redemption and snapshot columns NOT NULL unless the row is a cancel tombstone,
 * so the row is a union discriminated by status.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   source: string,
 *   branch_id: string | null,
 *   request_id: string,
 *   cart_id: string,
 *   cart_line_id: string,
 *   fingerprint: string | null,
 *   redemption_request_id: string | null,
 *   staff_user_id: string | null,
 *   quota_decremented: boolean,
 *   cancel_request_id: string | null,
 *   cancel_fingerprint: string | null,
 *   cancel_reason: string | null,
 *   reversal_id: string | null,
 *   created_at: Date | string,
 *   updated_at: Date | string,
 *   cancelled_at: Date | string | null,
 *   recorded_at: Date | string | null
 * }} PosCheckoutIntentColumns
 * @typedef {PosCheckoutIntentColumns & {
 *   status: "authorized" | "recorded",
 *   customer_id: string,
 *   redemption_id: string,
 *   authorization_snapshot: PosCheckoutAuthorizationSnapshot,
 *   completion_payload: PosCheckoutCompletionPayload | null
 * }} PosCheckoutAuthorizedIntent
 * @typedef {PosCheckoutIntentColumns & {
 *   status: "cancelled",
 *   customer_id: string | null,
 *   redemption_id: string | null,
 *   authorization_snapshot: PosCheckoutAuthorizationSnapshot | null,
 *   completion_payload: PosCheckoutCompletionPayload | null
 * }} PosCheckoutCancelledIntent
 * @typedef {PosCheckoutAuthorizedIntent | PosCheckoutCancelledIntent} PosCheckoutIntentRow
 */

/**
 * @param {PosCheckoutQueryClient} client
 * @param {string} businessId
 * @param {string} source
 * @param {string} requestId
 */
export async function lockCheckout(client, businessId, source, requestId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
    businessId,
    `checkout:${source}:${requestId}`,
  ]);
}
/**
 * @param {PosCheckoutQueryClient} client
 * @param {string} businessId
 * @param {string} source
 * @param {string} requestId
 * @returns {Promise<PosCheckoutIntentRow | undefined>}
 */
export async function checkoutIntent(client, businessId, source, requestId) {
  return (
    await client.query(
      "SELECT * FROM pos_checkout_intents WHERE business_id=$1 AND source=$2 AND request_id=$3",
      [businessId, source, requestId],
    )
  ).rows[0];
}
/**
 * @param {PosCheckoutIntentRow} row
 * @param {boolean} [replay]
 */
export function checkoutResponse(row, replay = false) {
  return {
    ok: true,
    requestId: row.request_id,
    status: row.status,
    redemption: row.authorization_snapshot?.redemption ?? null,
    mapping: row.authorization_snapshot?.mapping ?? null,
    replay,
  };
}
/**
 * @param {PosCheckoutIntentRow} row
 * @param {{ branchId?: string | null, cartId?: string, cartLineId?: string }} input
 */
export function assertCheckoutCart(row, input) {
  if (
    (row.branch_id ?? null) !== (input.branchId ?? null) ||
    row.cart_id !== input.cartId ||
    row.cart_line_id !== input.cartLineId
  )
    throw conflict("La solicitud corresponde a otro carrito, línea o sucursal.");
}
// Serializes with cancellation before locking the debit or fulfillment record.
/**
 * @param {PosCheckoutQueryClient} client
 * @param {string} businessId
 * @param {string} redemptionId
 * @returns {Promise<PosCheckoutIntentRow | null | undefined>}
 */
export async function checkoutForRedemption(client, businessId, redemptionId) {
  const b = (await client.query("SELECT program_json FROM businesses WHERE id=$1", [businessId]))
    .rows[0];
  if (b?.program_json?.pos_checkout_enabled !== true) return null;
  const row = (
    await client.query(
      "SELECT source,request_id FROM pos_checkout_intents WHERE business_id=$1 AND redemption_id=$2",
      [businessId, redemptionId],
    )
  ).rows[0];
  if (!row) return null;
  await lockCheckout(client, businessId, row.source, row.request_id);
  return checkoutIntent(client, businessId, row.source, row.request_id);
}
/**
 * @param {PosCheckoutQueryClient} client
 * @param {PosCheckoutIntentRow} intent
 */
export async function completeCheckout(client, intent) {
  if (intent.status === "recorded") return;
  if (intent.status !== "authorized" || !intent.completion_payload)
    throw conflict("El carrito fue cancelado o necesita revisión.");
  // Earned program terms remain open while the POS is pending, and are completed
  // only by durable evidence of fulfillment. Cancellation never reopens history.
  await client.query("SELECT id FROM businesses WHERE id=$1 FOR SHARE", [intent.business_id]);
  await client.query("SELECT customer_id FROM customer_balances WHERE customer_id=$1 FOR UPDATE", [
    intent.customer_id,
  ]);
  await completeLegacyProtectedRedemption(client, intent.completion_payload);
  await client.query(
    "UPDATE customers SET last_visit_at=GREATEST(COALESCE(last_visit_at,now()),now()) WHERE business_id=$1 AND id=$2",
    [intent.business_id, intent.customer_id],
  );
  await client.query(
    "UPDATE pos_checkout_intents SET status='recorded',recorded_at=now(),updated_at=now() WHERE id=$1",
    [intent.id],
  );
  const p = intent.completion_payload;
  await enqueueWebhookEvent(intent.business_id, "reward.redeemed", {
    redemption_id: intent.redemption_id,
    customer_id: intent.customer_id,
    reward_id: p.reward.id,
    points_cost: p.pointsCost,
    code: intent.authorization_snapshot.redemption.code,
  });
}
