import { reportingPurchase } from "../reporting-purchase.js";

/**
 * A recorded purchase that still stands: refunded, reversed and adjustment rows
 * are excluded (reporting-purchase.js), and so are PENDING purchases, which can
 * still be refunded during their hold. Expired points do not undo the sale.
 * Used for referral minimums and for refund reconciliation of challenges.
 * The alias must be a code-supplied, unqualified SQL identifier.
 */
export function settledPurchase(alias) {
  return `(${reportingPurchase(alias)} AND ${alias}.status <> 'PENDING')`;
}

export async function getSettledPurchaseSummary(query, customerId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(t.amount_q), 0) AS total_spend, COUNT(*)::int AS purchases
     FROM transactions t
     WHERE t.customer_id = $1
       AND ${settledPurchase("t")}`,
    [customerId]
  );
  return {
    totalSpend: Number.parseFloat(rows[0]?.total_spend ?? 0) || 0,
    purchases: Number(rows[0]?.purchases ?? 0) || 0
  };
}

// With a minimum, the settled purchase total must reach it; without one, any
// settled purchase qualifies.
export function referralPurchaseRequirementMet(summary, minPurchase) {
  const minimum = Number.parseFloat(minPurchase ?? "");
  if (Number.isFinite(minimum) && minimum > 0) return Number(summary?.totalSpend || 0) >= minimum;
  return Number(summary?.purchases || 0) > 0;
}
