import { dbQuery } from "../../database.js";
import { notFound } from "../../../utils/http-error.js";

const CUSTOMER_STATS_SQL = `SELECT
  c.business_id,
  cb.points,
  cl.total_spend,
  cl.total_visits,
  vs.current_streak,
  COUNT(r.id) as referral_count,
  (
    SELECT COALESCE(SUM(t.items), 0)
    FROM transactions t
    WHERE t.customer_id = c.id
      AND t.source <> 'reversal'
      AND t.status <> 'REVERSED'
  ) AS total_items
FROM customers c
LEFT JOIN customer_balances cb ON cb.customer_id = c.id
LEFT JOIN customer_ltv cl ON cl.customer_id = c.id
LEFT JOIN visit_streaks vs ON vs.customer_id = c.id
LEFT JOIN referrals r ON r.referrer_customer_id = c.id AND r.status = 'completed'
WHERE c.id = $1
GROUP BY c.id, c.business_id, cb.points, cl.total_spend, cl.total_visits, vs.current_streak`;

/**
 * Aggregated gamification counters for one customer (CUSTOMER_STATS_SQL).
 * Sums over NUMERIC/bigint columns arrive as strings.
 * Unit tests pass partial objects, so every counter is optional; `business_id`
 * is always present (the statement groups by it).
 * @typedef {{
 *   business_id: string,
 *   points?: number | null,
 *   total_spend?: string | number | null,
 *   total_visits?: number | null,
 *   current_streak?: number | null,
 *   referral_count?: number | string,
 *   total_items?: number | string | null,
 * }} GamificationStats
 */

/**
 * @param {string} customerId
 * @param {typeof dbQuery} [query]
 * @returns {Promise<GamificationStats>}
 */
export async function getCustomerGamificationStats(customerId, query = dbQuery) {
  const { rows } = await query(CUSTOMER_STATS_SQL, [customerId]);
  if (!rows[0]) throw notFound("Cliente no encontrado");
  return rows[0];
}
