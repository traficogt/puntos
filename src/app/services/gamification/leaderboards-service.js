import { GamificationRepository } from "../../repositories/gamification-repository.js";
import { dbQuery } from "../../database.js";
import { notFound } from "../../../utils/http-error.js";

export async function getPointsLeaderboard(businessId, limit = 10, timeframe = "all_time") {
  return GamificationRepository.getPointsLeaderboard(businessId, limit, timeframe);
}

export async function getStreakLeaderboard(businessId, limit = 10) {
  return GamificationRepository.getStreakLeaderboard(businessId, limit);
}

export async function getCustomerPosition(customerId, leaderboardType = "points") {
  const { rows: customerData } = await dbQuery(`SELECT business_id FROM customers WHERE id = $1`, [customerId]);
  if (!customerData[0]) throw notFound("Customer not found");

  const { business_id: businessId } = customerData[0];
  if (leaderboardType === "points") {
    const { rows } = await dbQuery(
      `WITH ranked AS (
         SELECT
           c.id,
           c.name,
           cb.points,
           RANK() OVER (ORDER BY cb.points DESC) as position
         FROM customers c
         JOIN customer_balances cb ON cb.customer_id = c.id
         WHERE c.business_id = $1 AND c.deleted_at IS NULL
       )
       SELECT * FROM ranked WHERE id = $2`,
      [businessId, customerId]
    );
    return rows[0];
  }

  if (leaderboardType === "streak") {
    const { rows } = await dbQuery(
      `WITH ranked AS (
         SELECT
           c.id,
           c.name,
           vs.current_streak,
           RANK() OVER (ORDER BY vs.current_streak DESC) as position
         FROM customers c
         JOIN visit_streaks vs ON vs.customer_id = c.id
         WHERE c.business_id = $1 AND c.deleted_at IS NULL
       )
       SELECT * FROM ranked WHERE id = $2`,
      [businessId, customerId]
    );
    return rows[0];
  }

  return null;
}
