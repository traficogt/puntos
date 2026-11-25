import { awardSchema } from "./transaction-evidence-schema.js";

/**
 * transactions row joined for the customer history (reward_name, has_original_transaction).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id: string | null,
 *   customer_id: string,
 *   amount_q: string | number | null,
 *   points_delta: number | string,
 *   source: string | null,
 *   type: string | null,
 *   status: string,
 *   created_at: string | Date,
 *   visits?: number | null,
 *   items?: number | null,
 *   meta?: Record<string, unknown> | null,
 *   reward_name?: string | null,
 *   has_original_transaction?: boolean,
 *   reversed_transaction_id?: string | null,
 * }} CustomerTransactionRow
 */

/** @type {Array<string | null>} */
const purchaseSources = ["online", "offline", "external", "order"];
/** @type {Map<string | null, string>} */
const typeKinds = new Map([
  ["REFERRAL_REWARD", "referral_bonus"],
  ["ACHIEVEMENT", "achievement_bonus"],
  ["ACHIEVEMENT_REWARD", "achievement_bonus"],
  ["CHALLENGE", "challenge_bonus"],
  ["TIER_BONUS", "other_bonus"],
  ["REWARD", "other_bonus"],
  ["OPENING_BALANCE", "opening_balance"],
  ["MANUAL_ADJUSTMENT", "adjustment"],
  ["ADJUSTMENT", "adjustment"],
  ["REDEMPTION", "redemption"],
  ["REFUND", "reversal"],
]);
/** @type {Map<string | null, string>} */
const sourceKinds = new Map([
  ["referral", "referral_bonus"],
  ["achievement", "achievement_bonus"],
  ["challenge", "challenge_bonus"],
  ["tier", "other_bonus"],
  ["birthday", "birthday_bonus"],
  ["anniversary", "other_bonus"],
  ["reactivation", "other_bonus"],
  ["migration", "opening_balance"],
  ["ledger_correction", "adjustment"],
  ["redeem", "redemption"],
  ["expire", "expiry"],
  ["reversal", "reversal"],
  ["pos_checkout_cancel", "reversal"],
]);

/** @param {CustomerTransactionRow} row */
function includesDocumentedBonus(row) {
  const parsed = awardSchema.safeParse(row.meta?.award_evidence);
  if (!parsed.success) return false;
  const award = parsed.data;
  if (
    award.awarded_points !== Number(row.points_delta) ||
    award.program_points + award.targeted_offer.bonus_points !== award.awarded_points ||
    award.inputs.amount_q !== Number(row.amount_q) ||
    award.inputs.visits !== Number(row.visits) ||
    award.inputs.items !== Number(row.items)
  )
    return false;
  return (
    award.targeted_offer.bonus_points > 0 ||
    award.rules.some((rule) => rule.outcome === "applied" && rule.points_after > rule.points_before)
  );
}

/**
 * Classify only persisted, recognized evidence. Never expose metadata or infer a base/bonus split.
 * @param {CustomerTransactionRow} row
 */
export function customerPointProvenance(row) {
  // The checkout cancellation writer records a zero-point ADJUSTMENT marker;
  // its actual balance restoration remains in the separate statement ledger.
  const linkedReversal = row.source === "reversal" && row.has_original_transaction === true;
  const fromType =
    linkedReversal || (row.type === "ADJUSTMENT" && row.source === "pos_checkout_cancel")
      ? "reversal"
      : typeKinds.get(row.type);
  let fromSource = sourceKinds.get(row.source);
  if (row.source === "lifecycle")
    fromSource =
      row.meta?.event_type === "birthday_bonus"
        ? "birthday_bonus"
        : row.meta?.event_type === "winback_bonus"
          ? "other_bonus"
          : undefined;
  const defaultType = row.type === "PURCHASE" || row.type == null;
  const defaultSource = row.source == null || row.source === "online";
  let kind = "unknown";
  if (fromType && (!fromSource || fromType === fromSource) && (defaultSource || fromSource))
    kind = fromType;
  else if (fromSource && (defaultType || fromType === fromSource)) kind = fromSource;
  else if (row.type === "PURCHASE" && purchaseSources.includes(row.source)) kind = "purchase";
  const points = Number(row.points_delta);
  if (
    !Number.isFinite(points) ||
    ([
      "purchase",
      "opening_balance",
      "referral_bonus",
      "achievement_bonus",
      "challenge_bonus",
      "birthday_bonus",
      "other_bonus",
    ].includes(kind) &&
      points < 0) ||
    (kind === "redemption" && points > 0) ||
    (kind === "expiry" && points >= 0)
  )
    kind = "unknown";
  const status = row.reversed_transaction_id
    ? "REVERSED"
    : ["POSTED", "PENDING", "REVERSED", "EXPIRED"].includes(row.status)
      ? row.status
      : "UNKNOWN";
  return { kind, status, includes_bonus: kind === "purchase" && includesDocumentedBonus(row) };
}

/**
 * Browser history retains public legacy fields; metadata and staff identifiers stay internal.
 * @param {CustomerTransactionRow} row
 */
export function publicCustomerTransaction(row) {
  return {
    id: row.id,
    business_id: row.business_id,
    branch_id: row.branch_id,
    customer_id: row.customer_id,
    amount_q: row.amount_q,
    points_delta: row.points_delta,
    source: row.source,
    created_at: row.created_at,
    reward_name: row.reward_name,
    provenance: customerPointProvenance(row),
  };
}
