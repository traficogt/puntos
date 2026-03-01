import { dbQuery } from "../database.js";

export const TierRepository = {
  async create(tierData) {
    const { rows } = await dbQuery(
      `INSERT INTO loyalty_tiers 
       (business_id, name, tier_level, min_points, min_spend, min_visits, 
        points_multiplier, perks, color, icon_url, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tierData.business_id,
        tierData.name,
        tierData.tier_level,
        tierData.min_points || 0,
        tierData.min_spend || null,
        tierData.min_visits || null,
        tierData.points_multiplier || 1.0,
        JSON.stringify(tierData.perks || []),
        tierData.color || null,
        tierData.icon_url || null,
        tierData.active !== false
      ]
    );
    return rows[0];
  },

  async listByBusiness(businessId) {
    const { rows } = await dbQuery(
      `SELECT * FROM loyalty_tiers
       WHERE business_id = $1
       ORDER BY tier_level ASC`,
      [businessId]
    );
    return rows;
  },

  async getById(tierId) {
    const { rows } = await dbQuery(
      `SELECT * FROM loyalty_tiers WHERE id = $1`,
      [tierId]
    );
    return rows[0];
  },

  async update(tierId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key === "perks" && value) {
        fields.push(`${key} = $${paramCount}`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
      }
      paramCount++;
    }

    fields.push(`updated_at = now()`);
    values.push(tierId);

    const { rows } = await dbQuery(
      `UPDATE loyalty_tiers 
       SET ${fields.join(", ")}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );
    return rows[0];
  },

  async delete(tierId) {
    await dbQuery(`DELETE FROM loyalty_tiers WHERE id = $1`, [tierId]);
  },

  async getCustomerTier(customerId) {
    const { rows } = await dbQuery(
      `SELECT lt.*, ct.achieved_at
       FROM customer_tiers ct
       JOIN loyalty_tiers lt ON ct.tier_id = lt.id
       WHERE ct.customer_id = $1`,
      [customerId]
    );
    return rows[0];
  },

  async getCustomerTierWithProgress(customerId) {
    const { rows } = await dbQuery(
      `SELECT 
         lt.*, 
         ct.achieved_at,
         cb.points as current_points,
         next_tier.name as next_tier_name,
         next_tier.min_points as next_tier_points,
         (next_tier.min_points - cb.points) as points_to_next_tier
       FROM customer_tiers ct
       JOIN loyalty_tiers lt ON ct.tier_id = lt.id
       JOIN customer_balances cb ON cb.customer_id = ct.customer_id
       LEFT JOIN loyalty_tiers next_tier ON 
         next_tier.business_id = lt.business_id AND
         next_tier.tier_level = lt.tier_level + 1 AND
         next_tier.active = true
       WHERE ct.customer_id = $1`,
      [customerId]
    );
    return rows[0];
  },

  async assignCustomerToTier(customerId, tierId) {
    const { rows } = await dbQuery(
      `INSERT INTO customer_tiers (customer_id, tier_id)
       VALUES ($1, $2)
       ON CONFLICT (customer_id)
       DO UPDATE SET 
         tier_id = $2,
         updated_at = now()
       RETURNING *`,
      [customerId, tierId]
    );
    return rows[0];
  },

  async getTierHistory(customerId) {
    const { rows } = await dbQuery(
      `SELECT 
         th.*,
         from_tier.name as from_tier_name,
         to_tier.name as to_tier_name
       FROM tier_history th
       LEFT JOIN loyalty_tiers from_tier ON th.from_tier_id = from_tier.id
       JOIN loyalty_tiers to_tier ON th.to_tier_id = to_tier.id
       WHERE th.customer_id = $1
       ORDER BY th.changed_at DESC`,
      [customerId]
    );
    return rows;
  },

  async getTierStats(businessId) {
    const { rows } = await dbQuery(
      `SELECT 
         lt.id,
         lt.name,
         lt.tier_level,
         COUNT(ct.customer_id) as customer_count,
         AVG(cb.points) as avg_points,
         SUM(cb.points) as total_points
       FROM loyalty_tiers lt
       LEFT JOIN customer_tiers ct ON lt.id = ct.tier_id
       LEFT JOIN customer_balances cb ON ct.customer_id = cb.customer_id
       WHERE lt.business_id = $1
       GROUP BY lt.id, lt.name, lt.tier_level
       ORDER BY lt.tier_level ASC`,
      [businessId]
    );
    return rows;
  }
};
