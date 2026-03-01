import { one, many, exec } from "./base.js";
import { withTransaction } from "../database.js";

export const RewardRepo = {
  async create({ id, business_id, name, description, points_cost, active, stock, valid_until, branch_ids }) {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO rewards (id, business_id, name, description, points_cost, active, stock, valid_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, business_id, name, description ?? null, points_cost, active ?? true, stock ?? null, valid_until ?? null]
      );
      if (Array.isArray(branch_ids) && branch_ids.length) {
        for (const branchId of branch_ids) {
          await client.query(
            `INSERT INTO reward_branches (reward_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, branchId]
          );
        }
      }
    });
    return this.getById(id, business_id);
  },

  async getById(id, businessId = null) {
    const params = [id];
    const bizFilter = businessId ? `AND r.business_id = $2` : "";
    if (businessId) params.push(businessId);
    return one(
      `SELECT
         r.*,
         COALESCE(array_agg(DISTINCT rb.branch_id) FILTER (WHERE rb.branch_id IS NOT NULL), '{}'::uuid[]) AS branch_ids,
         COALESCE(
           array_agg(
             DISTINCT (
               b.name || CASE WHEN b.code IS NOT NULL AND b.code <> '' THEN ' (' || b.code || ')' ELSE '' END
             )
           ) FILTER (WHERE b.id IS NOT NULL),
           '{}'::text[]
         ) AS branch_labels
       FROM rewards r
       LEFT JOIN reward_branches rb ON rb.reward_id = r.id
       LEFT JOIN branches b ON b.id = rb.branch_id
       WHERE r.id=$1 ${bizFilter}
       GROUP BY r.id`,
      params
    );
  },

  async listByBusiness(businessId) {
    return many(
      `SELECT
         r.*,
         COALESCE(array_agg(DISTINCT rb.branch_id) FILTER (WHERE rb.branch_id IS NOT NULL), '{}'::uuid[]) AS branch_ids,
         COALESCE(
           array_agg(
             DISTINCT (
               b.name || CASE WHEN b.code IS NOT NULL AND b.code <> '' THEN ' (' || b.code || ')' ELSE '' END
             )
           ) FILTER (WHERE b.id IS NOT NULL),
           '{}'::text[]
         ) AS branch_labels
       FROM rewards r
       LEFT JOIN reward_branches rb ON rb.reward_id = r.id
       LEFT JOIN branches b ON b.id = rb.branch_id
       WHERE r.business_id=$1
       GROUP BY r.id
       ORDER BY r.created_at DESC`,
      [businessId]
    );
  },

  async update(id, patch) {
    const fields = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      fields.push(`${k}=$${i++}`);
      vals.push(v);
    }
    if (!fields.length) return this.getById(id);
    vals.push(id);
    await exec(`UPDATE rewards SET ${fields.join(", ")} WHERE id=$${i}`, vals);
    return this.getById(id);
  },

  async setBranches(rewardId, branchIds = []) {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM reward_branches WHERE reward_id = $1`, [rewardId]);
      for (const branchId of branchIds) {
        await client.query(
          `INSERT INTO reward_branches (reward_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [rewardId, branchId]
        );
      }
    });
    return this.getById(rewardId);
  },

  async listBranchIds(rewardId) {
    const rows = await many(`SELECT branch_id FROM reward_branches WHERE reward_id=$1`, [rewardId]);
    return rows.map((r) => String(r.branch_id));
  }
};
