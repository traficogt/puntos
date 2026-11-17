import { dbQuery } from "../../database.js";
import { notFound } from "../../../utils/http-error.js";
import { reportingPurchase } from "../reporting-purchase.js";

// Spend and visits come from customer_ltv, which counts recorded purchases
// (reportingPurchase); items use the same definition, so non-sale rows,
// refunded purchases and reversal links never count.
const CUSTOMER_STATS_SQL = `SELECT
  c.business_id,
  cb.points,
  cb.lifetime_points,
  cl.total_spend,
  cl.total_visits,
  vs.current_streak,
  vs.longest_streak,
  COUNT(r.id) as referral_count,
  (
    SELECT COALESCE(SUM(t.items), 0)
    FROM transactions t
    WHERE t.customer_id = c.id
      AND ${reportingPurchase("t")}
  ) AS total_items
FROM customers c
LEFT JOIN customer_balances cb ON cb.customer_id = c.id
LEFT JOIN customer_ltv cl ON cl.customer_id = c.id
LEFT JOIN visit_streaks vs ON vs.customer_id = c.id
-- Rewarding moves a completed referral to 'rewarded'; both are completed referrals.
LEFT JOIN referrals r ON r.referrer_customer_id = c.id AND r.status IN ('completed', 'rewarded')
WHERE c.id = $1
GROUP BY c.id, c.business_id, cb.points, cb.lifetime_points, cl.total_spend, cl.total_visits,
  vs.current_streak, vs.longest_streak`;

export async function getCustomerGamificationStats(customerId, query = dbQuery) {
  const { rows } = await query(CUSTOMER_STATS_SQL, [customerId]);
  if (!rows[0]) throw notFound("Customer not found");
  return rows[0];
}
