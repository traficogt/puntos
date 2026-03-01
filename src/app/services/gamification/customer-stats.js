import { dbQuery } from "../../database.js";
import { notFound } from "../../../utils/http-error.js";

const CUSTOMER_STATS_SQL = `SELECT
  c.business_id,
  cb.points,
  cl.total_spend,
  cl.total_visits,
  vs.current_streak,
  COUNT(r.id) as referral_count
FROM customers c
LEFT JOIN customer_balances cb ON cb.customer_id = c.id
LEFT JOIN customer_ltv cl ON cl.customer_id = c.id
LEFT JOIN visit_streaks vs ON vs.customer_id = c.id
LEFT JOIN referrals r ON r.referrer_customer_id = c.id AND r.status = 'completed'
WHERE c.id = $1
GROUP BY c.id, c.business_id, cb.points, cl.total_spend, cl.total_visits, vs.current_streak`;

export async function getCustomerGamificationStats(customerId, query = dbQuery) {
  const { rows } = await query(CUSTOMER_STATS_SQL, [customerId]);
  if (!rows[0]) throw notFound("Customer not found");
  return rows[0];
}
