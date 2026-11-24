import { one, many } from "./base.js";
import { withTransaction } from "../database.js";

/** @typedef {import("./base.js").DbClient} DbClient */

/**
 * Row of `rewards`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   description: string | null,
 *   points_cost: number,
 *   active: boolean,
 *   stock: number | null,
 *   valid_until: Date | null,
 *   created_at: Date
 * }} RewardRow
 */

/**
 * Reward with its branch eligibility aggregated from `reward_branches`.
 * @typedef {RewardRow & { branch_ids: string[], branch_labels: string[] }} RewardWithBranchesRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   description?: string | null,
 *   points_cost: number,
 *   active?: boolean | null,
 *   stock?: number | null,
 *   valid_until?: Date | string | null,
 *   branch_ids?: string[] | null
 * }} RewardCreateInput
 */

/**
 * Column assignments accepted by {@link RewardRepo.update}.
 * @typedef {Partial<Pick<RewardRow, "name" | "description" | "points_cost" | "active" | "stock">>
 *   & { valid_until?: Date | string | null }} RewardPatch
 */

export const RewardRepo = {
  /**
   * Resolves to `RewardWithBranchesRow | null`.
   * @param {RewardCreateInput} reward
   */
  async create({
    id,
    business_id,
    name,
    description,
    points_cost,
    active,
    stock,
    valid_until,
    branch_ids,
  }) {
    await withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE", [business_id]);
        // Publish only after branch eligibility is complete. An active intermediate
        // row would incorrectly appear to promise redemption at every branch.
        await client.query(
          `INSERT INTO rewards (id, business_id, name, description, points_cost, active, stock, valid_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            business_id,
            name,
            description ?? null,
            points_cost,
            false,
            stock ?? null,
            valid_until ?? null,
          ],
        );
        if (Array.isArray(branch_ids) && branch_ids.length) {
          for (const branchId of branch_ids) {
            await client.query(
              `INSERT INTO reward_branches (reward_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [id, branchId],
            );
          }
        }
        if (active ?? true) {
          await client.query(`UPDATE rewards SET active = true WHERE id=$1 AND business_id=$2`, [
            id,
            business_id,
          ]);
        }
      },
    );
    return this.getById(id, business_id);
  },

  /**
   * Resolves to `RewardWithBranchesRow | null`.
   * @param {string} id
   * @param {string | null} [businessId] when given, the reward must belong to this business
   */
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
      params,
    );
  },

  /**
   * Resolves to `RewardWithBranchesRow[]`.
   * @param {string} businessId
   */
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
      [businessId],
    );
  },

  /**
   * Resolves to `RewardWithBranchesRow | null`.
   * @param {string} id
   * @param {RewardPatch} patch
   */
  async update(id, patch) {
    /** @type {string[]} */
    const fields = [];
    /** @type {unknown[]} */
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      fields.push(`${k}=$${i++}`);
      vals.push(v);
    }
    if (!fields.length) return this.getById(id);
    vals.push(id);
    await withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query(
          "SELECT b.id FROM businesses b JOIN rewards r ON r.business_id=b.id WHERE r.id=$1 FOR UPDATE OF b",
          [id],
        );
        await client.query(`UPDATE rewards SET ${fields.join(", ")} WHERE id=$${i}`, vals);
      },
    );
    return this.getById(id);
  },

  /**
   * Resolves to `RewardWithBranchesRow | null`.
   * @param {string} rewardId
   * @param {string[]} [branchIds]
   */
  async setBranches(rewardId, branchIds = []) {
    await withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query(
          "SELECT b.id FROM businesses b JOIN rewards r ON r.business_id=b.id WHERE r.id=$1 FOR UPDATE OF b",
          [rewardId],
        );
        await client.query("SELECT id FROM rewards WHERE id=$1 FOR UPDATE", [rewardId]);
        await client.query(`DELETE FROM reward_branches WHERE reward_id = $1`, [rewardId]);
        for (const branchId of branchIds) {
          await client.query(
            `INSERT INTO reward_branches (reward_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [rewardId, branchId],
          );
        }
      },
    );
    return this.getById(rewardId);
  },

  /**
   * @param {string} rewardId
   * @returns {Promise<string[]>}
   */
  async listBranchIds(rewardId) {
    /** @type {Array<{ branch_id: string }>} */
    const rows = await many(`SELECT branch_id FROM reward_branches WHERE reward_id=$1`, [rewardId]);
    return rows.map((r) => String(r.branch_id));
  },
};
