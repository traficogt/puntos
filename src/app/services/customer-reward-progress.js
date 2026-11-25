import {
  rewardSnapshotSql,
  walletTimezoneDefaults,
} from "../repositories/native-wallet-snapshot.js";
import { buildWalletEngagement } from "./native-wallet/engagement.js";
import { withWalletRewardInventory, walletInventoryEngagement } from "./reward-inventory-public.js";

/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */
/**
 * Reward row of a wallet snapshot (reward-inventory-public.js), as read here.
 * @typedef {{
 *   id: string,
 *   name?: string | null,
 *   reward_name?: string | null,
 *   description?: string | null,
 *   protected_description?: string | null,
 *   promise_id?: string | null,
 *   points_cost: number | string,
 *   active?: boolean,
 *   stock?: number | null,
 *   valid_until?: string | Date | null,
 *   branch_ids?: string[] | null,
 *   inventory?: unknown,
 * }} CustomerRewardChoice
 */

const customerSnapshotSql = rewardSnapshotSql(`
 SELECT c.business_id,c.id AS customer_id,cb.points,cb.pending_points,
 b.program_type,b.program_json,false AS is_voided,statement_timestamp() AS snapshot_at,
 COALESCE((SELECT name FROM pg_timezone_names WHERE name=b.program_json->'region'->>'timezone'),
 '${walletTimezoneDefaults}'::jsonb->>(b.program_json->'region'->>'country'),'America/Guatemala') AS timezone
 FROM customers c JOIN customer_balances cb ON cb.customer_id=c.id
 JOIN businesses b ON b.id=c.business_id
 WHERE c.business_id=$1 AND c.id=$2 AND c.deleted_at IS NULL`);

/**
 * Read a customer-scoped snapshot; never create or return a Wallet pass or credential.
 * @param {TxClient} client
 * @param {{ businessId: string, customerId: string }} target
 */
export async function getCustomerRewardProgress(client, { businessId, customerId }) {
  const stored = (await client.query(customerSnapshotSql, [businessId, customerId])).rows[0];
  if (!stored) return null;
  const snapshot = await withWalletRewardInventory(client, stored);
  const engagement = walletInventoryEngagement(snapshot, buildWalletEngagement(snapshot));
  const choices = snapshot.wallet_rewards.map((/** @type {CustomerRewardChoice} */ reward) => {
    const eligible = buildWalletEngagement({ ...snapshot, wallet_rewards: [reward] }).reward;
    const scoped = reward.branch_ids?.length
      ? snapshot.wallet_branches.filter((/** @type {{ id: string, name: string }} */ branch) =>
          /** @type {string[]} */ (reward.branch_ids).includes(branch.id),
        )
      : [];
    return {
      id: reward.id,
      name: reward.reward_name ?? reward.name,
      description: reward.promise_id
        ? (reward.protected_description ?? "")
        : (reward.description ?? ""),
      points_cost: Number(reward.points_cost),
      protected: Boolean(reward.promise_id),
      active: Boolean(reward.promise_id || reward.active),
      available: Boolean(eligible),
      stock: reward.stock,
      valid_until: reward.valid_until ?? null,
      branch_ids: reward.branch_ids ?? [],
      branch_labels: scoped.map(
        (/** @type {{ id: string, name: string }} */ branch) => branch.name,
      ),
      ...(reward.inventory ? { inventory: reward.inventory } : {}),
    };
  });
  return {
    available_points: Number(snapshot.points) || 0,
    pending_points: Number(snapshot.pending_points) || 0,
    as_of: new Date(snapshot.snapshot_at).toISOString(),
    reward: engagement.reward,
    choices,
    earning: engagement.earning,
    conditions: engagement.conditions,
    next_refresh_at: engagement.next_refresh_at,
  };
}
