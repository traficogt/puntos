import crypto from "node:crypto";
import bcrypt from "bcryptjs";

import { StaffRepo } from "../repositories/staff-repository.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { RewardRepo } from "../repositories/reward-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { signStaffToken } from "../../utils/auth-token.js";
import { withTransaction, setCurrentTenant } from "../database.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../../utils/http-error.js";
import { settlePendingPointsForCustomer, expirePointsForCustomer, refundAwardTransaction } from "./loyalty-ops-service.js";
import { enqueueWebhookEvent } from "./webhook-service.js";
import { awardPoints, awardPointsWithDeps } from "./staff-award-service.js";

function id() {
  return crypto.randomUUID();
}

export async function staffLogin({ email, password }) {
  const staff = await StaffRepo.getByEmail(email);
  if (!staff || !staff.active) {
    await SecurityEventRepo.log({
      event_type: "staff_login_failed",
      severity: "MEDIUM",
      route: "/api/staff/login",
      method: "POST",
      business_id: staff?.business_id ?? null,
      actor_type: "STAFF",
      actor_id: staff?.id ?? null,
      meta: { email: String(email || "").toLowerCase(), reason: "not_found_or_inactive" }
    }).catch(() => {});
    throw unauthorized("Invalid credentials");
  }

  await setCurrentTenant(String(staff.business_id));

  const ok = await bcrypt.compare(password, staff.password_hash);
  if (!ok) {
    await SecurityEventRepo.log({
      event_type: "staff_login_failed",
      severity: "MEDIUM",
      route: "/api/staff/login",
      method: "POST",
      business_id: staff.business_id,
      actor_type: "STAFF",
      actor_id: staff.id,
      meta: { email: String(email || "").toLowerCase(), reason: "wrong_password" }
    }).catch(() => {});
    throw unauthorized("Invalid credentials");
  }

  const token = await signStaffToken({
    sid: staff.id,
    bid: staff.business_id,
    role: staff.role,
    brid: staff.branch_id ?? null
  });
  return {
    staff: {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      business_id: staff.business_id,
      branch_id: staff.branch_id
    },
    token
  };
}

export async function redeemReward({ staff, customerId, rewardId }) {
  const business = await BusinessRepo.getById(staff.business_id);
  if (!business) throw notFound("Business not found");

  await settlePendingPointsForCustomer(customerId, staff.business_id).catch(() => {});
  await expirePointsForCustomer(customerId, staff.business_id).catch(() => {});

  const redemptionGuard = business.program_json?.redemption_guard ?? {};
  const maxRedemptionsPerDay = Math.max(0, Math.floor(Number(redemptionGuard.max_redemptions_per_day ?? 0)));
  const maxRewardRedemptionsPerDay = Math.max(0, Math.floor(Number(redemptionGuard.max_reward_redemptions_per_day ?? 0)));
  const rewardCooldownHours = Math.max(0, Math.floor(Number(redemptionGuard.reward_cooldown_hours ?? 0)));

  const out = await withTransaction(async (client) => {
    const rewardResult = await client.query(
      `SELECT * FROM rewards WHERE id=$1 FOR UPDATE`,
      [rewardId]
    );
    const reward = rewardResult.rows[0];
    if (!reward || !reward.active) throw notFound("Reward not available");
    if (reward.business_id !== staff.business_id) throw forbidden("Reward belongs to different business");
    if (reward.valid_until && new Date(reward.valid_until) < new Date()) {
      throw badRequest("Reward expired");
    }

    const scopedBranches = await RewardRepo.listBranchIds(rewardId);
    if (scopedBranches.length > 0) {
      if (!staff.branch_id || !scopedBranches.includes(String(staff.branch_id))) {
        throw forbidden("Reward not available at this branch");
      }
    }

    const customerResult = await client.query(
      `SELECT id
       FROM customers
       WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL
       FOR UPDATE`,
      [customerId, staff.business_id]
    );
    if (!customerResult.rows.length) throw notFound("Customer not found");

    if (maxRedemptionsPerDay > 0) {
      const daily = await client.query(
        `SELECT COUNT(*)::int AS c
         FROM redemptions
         WHERE business_id = $1
           AND customer_id = $2
           AND created_at >= date_trunc('day', now())`,
        [staff.business_id, customerId]
      );
      if (Number(daily.rows?.[0]?.c ?? 0) >= maxRedemptionsPerDay) {
        throw conflict(`Daily redemption limit reached (${maxRedemptionsPerDay}/day)`);
      }
    }

    if (maxRewardRedemptionsPerDay > 0) {
      const daily = await client.query(
        `SELECT COUNT(*)::int AS c
         FROM redemptions
         WHERE business_id = $1
           AND customer_id = $2
           AND reward_id = $3
           AND created_at >= date_trunc('day', now())`,
        [staff.business_id, customerId, rewardId]
      );
      if (Number(daily.rows?.[0]?.c ?? 0) >= maxRewardRedemptionsPerDay) {
        throw conflict(`Daily limit reached for this reward (${maxRewardRedemptionsPerDay}/day)`);
      }
    }

    if (rewardCooldownHours > 0) {
      const latest = await client.query(
        `SELECT created_at
         FROM redemptions
         WHERE business_id = $1
           AND customer_id = $2
           AND reward_id = $3
         ORDER BY created_at DESC
         LIMIT 1`,
        [staff.business_id, customerId, rewardId]
      );
      const last = latest.rows?.[0]?.created_at ? new Date(latest.rows[0].created_at) : null;
      if (last) {
        const sinceHours = (Date.now() - last.getTime()) / (1000 * 60 * 60);
        if (sinceHours < rewardCooldownHours) {
          const wait = Math.ceil(rewardCooldownHours - sinceHours);
          throw conflict(`Reward cooldown active. Try again in ~${wait}h.`);
        }
      }
    }

    const cost = Number(reward.points_cost);
    const balanceUpdate = await client.query(
      `UPDATE customer_balances
       SET points = points - $2,
           updated_at=now()
       WHERE customer_id=$1 AND points >= $2
       RETURNING points`,
      [customerId, cost]
    );
    if (balanceUpdate.rowCount !== 1) throw conflict("Insufficient points");

    if (reward.stock !== null && reward.stock !== undefined) {
      const stockUpdate = await client.query(
        `UPDATE rewards SET stock = stock - 1
         WHERE id=$1 AND stock > 0
         RETURNING stock`,
        [rewardId]
      );
      if (stockUpdate.rowCount !== 1) throw conflict("Reward out of stock");
    }

    const redemptionId = id();
    let code = "";
    for (let i = 0; i < 5; i += 1) {
      code = crypto.randomBytes(4).toString("hex").toUpperCase();
      try {
        await client.query(
          `INSERT INTO redemptions (id, business_id, branch_id, reward_id, customer_id, staff_user_id, code, points_cost, status, redeemed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REDEEMED', now())`,
          [
            redemptionId,
            staff.business_id,
            staff.branch_id ?? null,
            rewardId,
            customerId,
            staff.id,
            code,
            cost
          ]
        );
        break;
      } catch (e) {
        if (String(e?.code) === "23505" && i < 4) continue;
        throw e;
      }
    }

    await client.query(
      `INSERT INTO transactions (id, business_id, branch_id, customer_id, staff_user_id, amount_q, points, source, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id(),
        staff.business_id,
        staff.branch_id ?? null,
        customerId,
        staff.id,
        0,
        -cost,
        "redeem",
        { reward_id: rewardId, redemption_id: redemptionId, code }
      ]
    );

    await client.query(`UPDATE customers SET last_visit_at=now() WHERE id=$1`, [customerId]);

    return {
      redemptionCode: code,
      rewardName: reward.name,
      newBalance: balanceUpdate.rows[0].points,
      redemptionId,
      pointsCost: cost
    };
  });

  enqueueWebhookEvent(staff.business_id, "reward.redeemed", {
    redemption_id: out.redemptionId,
    customer_id: customerId,
    reward_id: rewardId,
    points_cost: out.pointsCost,
    code: out.redemptionCode
  }).catch(() => {});

  return {
    redemptionCode: out.redemptionCode,
    rewardName: out.rewardName,
    newBalance: out.newBalance
  };
}

export async function syncAwards({ staff, awards }) {
  const results = [];
  for (const award of awards) {
    try {
      const result = await awardPoints({
        staff,
        customerQrToken: award.customerQrToken,
        amount_q: award.amount_q ?? 0,
        visits: award.visits,
        items: award.items,
        source: "offline",
        meta: { ...(award.meta ?? {}), client_ts: award.client_ts ?? null },
        txId: award.txId
      });
      results.push({ txId: award.txId, ok: true, result });
    } catch (e) {
      results.push({ txId: award.txId, ok: false, error: e?.message ?? String(e) });
    }
  }
  return results;
}

export async function refundAward(args) {
  return refundAwardTransaction(args);
}

export { awardPoints, awardPointsWithDeps };
