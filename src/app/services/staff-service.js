import { regionTimezone } from "./regional-settings.js";
import crypto from "node:crypto";

import { StaffRepo } from "../repositories/staff-repository.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { RewardRepo } from "../repositories/reward-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { signStaffToken } from "../../utils/auth-token.js";
import { withTransaction, setCurrentTenant, dbQuery } from "../database.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../../utils/http-error.js";
import { settlePendingPointsForCustomer, expirePointsForCustomer, refundAwardTransaction } from "./loyalty-ops-service.js";
import { enqueueWebhookEvent } from "./webhook-service.js";
import { awardPoints, awardPointsWithDeps } from "./staff-award-service.js";
import { logger } from "../../utils/logger.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { hashPassword, needsPasswordRehash, verifyPassword } from "../../utils/password-hash.js";
import { verifyQrToken } from "../../utils/qr-token.js";
import { verifyStaffMfaForLogin } from "./account-security-service.js";
import { isNativeWalletCode, resolveNativeWalletMembership } from "./native-wallet/membership.js";
import { recordFailedRedemption } from "./service-recovery-service.js";
import { protectedRedemptionReward, completeLegacyProtectedRedemption, lockProtectedRedemptionBusiness, protectedRedemptionName } from "./reward-promise-service.js";
import { snapshotCompletedRedemption } from "./reward-economics-service.js";
import { assertNoPendingCheckout } from "./pos-checkout-guard.js";
import { assertRewardInventory } from "./reward-inventory-service.js";

function id() {
  return crypto.randomUUID();
}

export async function lookupCustomerByQrTokenWithDeps(
  deps,
  { staff, customerQrToken }
) {
  let decoded;
  try {
    decoded = isNativeWalletCode(customerQrToken)
      ? await (deps.resolveNativeWalletMembership ?? resolveNativeWalletMembership)({ token: customerQrToken, staff })
      : await deps.verifyQrToken(customerQrToken);
  } catch (error) {
    if (isNativeWalletCode(customerQrToken) && error?.statusCode) throw error;
    throw badRequest(error?.message ?? "Invalid QR token");
  }

  const { bid, cid } = decoded;
  if (bid !== staff.business_id) throw forbidden("QR token is for a different business");

  const customer = await deps.CustomerRepo.getById(cid);
  if (!customer || customer.business_id !== staff.business_id || customer.deleted_at) throw notFound("Customer not found");

  return {
    customer: {
      id: customer.id,
      name: customer.name ?? null,
      phone: customer.phone ?? null,
      points: Number(customer.points ?? 0),
      pending_points: Number(customer.pending_points ?? 0)
    }
  };
}

async function findExistingRedemptionByRequestId(client, businessId, requestId) {
  if (!requestId) return null;
  const { rows } = await client.query(
    `SELECT r.id,
            r.business_id,
            r.customer_id,
            r.reward_id,
            r.code,
            r.points_cost,
            r.balance_after,
            rw.name AS reward_name
     FROM redemptions r
     JOIN rewards rw ON rw.id = r.reward_id
     WHERE r.business_id = $1
       AND r.request_id = $2`,
    [businessId, requestId]
  );
  return rows[0] ?? null;
}

async function lockRedemptionRequest(client, businessId, requestId) {
  if (!requestId) return;
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(businessId), String(requestId)]
  );
}

export async function staffLogin({ email, password, mfaCode = undefined }) {
  const loginRow = await StaffRepo.getByEmail(email);
  if (!loginRow || !loginRow.active) {
    await SecurityEventRepo.log({
      event_type: "staff_login_failed",
      severity: "MEDIUM",
      route: "/api/staff/login",
      method: "POST",
      business_id: loginRow?.business_id ?? null,
      actor_type: "STAFF",
      actor_id: loginRow?.id ?? null,
      meta: { email: String(email || "").toLowerCase(), reason: "not_found_or_inactive" }
    }).catch(() => {});
    throw unauthorized("Invalid credentials");
  }

  await setCurrentTenant(String(loginRow.business_id));
  const staff = await StaffRepo.getById(loginRow.id) || loginRow;

  const ok = await verifyPassword(password, staff.password_hash);
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

  if (needsPasswordRehash(staff.password_hash)) {
    const upgradedHash = await hashPassword(password);
    await dbQuery(
      `UPDATE staff_users
          SET password_hash = $2
        WHERE id = $1`,
      [staff.id, upgradedHash]
    ).catch(() => {});
  }

  const mfaResult = await verifyStaffMfaForLogin(staff, mfaCode);

  const token = await signStaffToken({
    sid: staff.id,
    bid: staff.business_id,
    role: staff.role,
    brid: staff.branch_id ?? null,
    mfaVerified: Boolean(mfaResult?.mfaVerified)
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

const customerLookupDeps = {
  verifyQrToken,
  resolveNativeWalletMembership,
  CustomerRepo
};

export async function lookupCustomerByQrToken(payload) {
  return lookupCustomerByQrTokenWithDeps(customerLookupDeps, payload);
}

const redeemDeps = {
  BusinessRepo,
  RewardRepo,
  withTransaction,
  settlePendingPointsForCustomer,
  expirePointsForCustomer,
  enqueueWebhookEvent,
  protectedRedemptionReward,
  lockProtectedRedemptionBusiness,
  protectedRedemptionName,
  completeLegacyProtectedRedemption
};

// Checkout owns the transaction and completes the earned terms on paid receipt.
export async function redeemCheckoutWithinTransaction(client, payload, captureCompletion) {
  // Settlement can lock the balance; retain business → reward → balance order.
  await client.query("SELECT id FROM businesses WHERE id=$1 FOR SHARE", [payload.staff.business_id]);
  await client.query("SELECT id FROM rewards WHERE business_id=$1 AND id=$2 FOR UPDATE", [payload.staff.business_id, payload.rewardId]);
  return redeemRewardWithDeps({
    ...redeemDeps,
    withTransaction: fn => fn(client),
    settlePendingPointsForCustomer: (customerId, businessId) => settlePendingPointsForCustomer(customerId, businessId, fn => fn(client)),
    expirePointsForCustomer: (customerId, businessId) => expirePointsForCustomer(customerId, businessId, fn => fn(client)),
    enqueueWebhookEvent: async () => {},
    deferVisit: true,
    completeLegacyProtectedRedemption: captureCompletion
  }, payload);
}

export async function redeemRewardWithDeps(
  deps,
  { staff, customerId, rewardId, requestId = null }
) {
  const business = await deps.BusinessRepo.getById(staff.business_id);
  if (!business) throw notFound("Business not found");

  await deps.settlePendingPointsForCustomer(customerId, staff.business_id).catch(() => {});
  await deps.expirePointsForCustomer(customerId, staff.business_id).catch(() => {});

  const redemptionGuard = business.program_json?.redemption_guard ?? {};
  const maxRedemptionsPerDay = Math.max(0, Math.floor(Number(redemptionGuard.max_redemptions_per_day ?? 0)));
  const maxRewardRedemptionsPerDay = Math.max(0, Math.floor(Number(redemptionGuard.max_reward_redemptions_per_day ?? 0)));
  const rewardCooldownHours = Math.max(0, Math.floor(Number(redemptionGuard.reward_cooldown_hours ?? 0)));

  const out = await deps.withTransaction(async (client) => {
    await lockRedemptionRequest(client, staff.business_id, requestId);
    const replay = await findExistingRedemptionByRequestId(client, staff.business_id, requestId);
    if (replay) {
      if (typeof deps.protectedRedemptionName === "function") replay.reward_name = await deps.protectedRedemptionName(client, replay.id) ?? replay.reward_name;
      if (replay.customer_id !== customerId || replay.reward_id !== rewardId) {
        throw conflict("requestId already used for a different redemption");
      }
      await AuditRepo.log({
        id: id(),
        business_id: staff.business_id,
        actor_type: "STAFF",
        actor_id: staff.id,
        action: "reward.redeem.replay",
        ip: null,
        ua: null,
        meta: withImpersonationMeta({
          redemption_id: replay.id,
          reward_id: rewardId,
          customer_id: customerId,
          request_id: requestId ?? null,
          code: replay.code
        }, staff)
      }).catch(() => {});
      logger.info({
        businessId: staff.business_id,
        customerId,
        rewardId,
        requestId,
        redemptionId: replay.id,
        staffId: staff.id,
        replay: true
      }, "Staff redeem replay returned existing redemption");
      return {
        redemptionCode: replay.code,
        rewardName: replay.reward_name,
        newBalance: replay.balance_after,
        redemptionId: replay.id,
        pointsCost: replay.points_cost,
        replay: true
      };
    }

    const lockedBusiness = typeof deps.lockProtectedRedemptionBusiness === "function"
      ? await deps.lockProtectedRedemptionBusiness(client, staff.business_id) : business;
    const redemptionTimezone = regionTimezone(lockedBusiness ?? business);
    const rewardResult = await client.query(
      `SELECT * FROM rewards WHERE id=$1 FOR UPDATE`,
      [rewardId]
    );
    let reward = rewardResult.rows[0];
    if (reward && reward.business_id === staff.business_id && typeof deps.protectedRedemptionReward === "function") {
      reward = await deps.protectedRedemptionReward(client, { businessId: staff.business_id, customerId, reward });
    }
    await assertNoPendingCheckout(client, { business: lockedBusiness ?? business, customerId });
    if (!reward || !reward.active) throw notFound("Reward not available");
    if (reward.business_id !== staff.business_id) throw forbidden("Reward belongs to different business");
    if (reward.valid_until && new Date(reward.valid_until) < new Date()) {
      throw badRequest("Reward expired");
    }

    const scopedBranches = reward.protected_branch_ids ?? await deps.RewardRepo.listBranchIds(rewardId);
    if (scopedBranches.length > 0) {
      if (!staff.branch_id || !scopedBranches.includes(String(staff.branch_id))) {
        throw forbidden("Reward not available at this branch");
      }
    }

    const customerResult = await client.query(
      `SELECT id
       FROM customers
       WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL
       FOR SHARE`,
      [customerId, staff.business_id]
    );
    if (!customerResult.rows.length) throw notFound("Customer not found");
    if ((lockedBusiness ?? business).program_json?.pos_inventory_checks === true) {
      await assertRewardInventory(client, { businessId: staff.business_id, rewardId, branchId: staff.branch_id ?? null });
    }

    if (maxRedemptionsPerDay > 0) {
      const daily = await client.query(
        `SELECT COUNT(*)::int AS c
         FROM redemptions
         WHERE business_id = $1
           AND status <> 'CANCELLED'
           AND customer_id = $2
           AND created_at >= (date_trunc('day', now() AT TIME ZONE $3) AT TIME ZONE $3)`,
        [staff.business_id, customerId, redemptionTimezone]
      );
      if (Number(daily.rows?.[0]?.c ?? 0) >= maxRedemptionsPerDay) {
        throw conflict(`Daily redemption limit reached (${maxRedemptionsPerDay}/day)`);
      }
    }

    if (maxRewardRedemptionsPerDay > 0) {
      const daily = await client.query(
        `SELECT COUNT(*)::int AS c
         FROM redemptions r
         LEFT JOIN reward_entitlement_fulfillments f ON f.redemption_id = r.id
         WHERE r.business_id = $1
           AND r.status <> 'CANCELLED'
           AND r.customer_id = $2
           AND COALESCE(f.original_reward_id, r.reward_id) = $3
           AND r.created_at >= (date_trunc('day', now() AT TIME ZONE $4) AT TIME ZONE $4)`,
        [staff.business_id, customerId, rewardId, redemptionTimezone]
      );
      if (Number(daily.rows?.[0]?.c ?? 0) >= maxRewardRedemptionsPerDay) {
        throw conflict(`Daily limit reached for this reward (${maxRewardRedemptionsPerDay}/day)`);
      }
    }

    if (rewardCooldownHours > 0) {
      const latest = await client.query(
        `SELECT r.created_at
         FROM redemptions r
         LEFT JOIN reward_entitlement_fulfillments f ON f.redemption_id = r.id
         WHERE r.business_id = $1
           AND r.status <> 'CANCELLED'
           AND r.customer_id = $2
           AND COALESCE(f.original_reward_id, r.reward_id) = $3
         ORDER BY r.created_at DESC
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
          `INSERT INTO redemptions
           (id, business_id, branch_id, reward_id, customer_id, staff_user_id, code, points_cost, status, redeemed_at, request_id, balance_after)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REDEEMED', now(), $9, $10)`,
          [
            redemptionId,
            staff.business_id,
            staff.branch_id ?? null,
            rewardId,
            customerId,
            staff.id,
            code,
            cost,
            requestId,
            balanceUpdate.rows[0].points
          ]
        );
        break;
      } catch (e) {
        if (String(e?.code) === "23505") {
          const replayAfterConflict = await findExistingRedemptionByRequestId(client, staff.business_id, requestId);
          if (replayAfterConflict) {
            if (replayAfterConflict.customer_id !== customerId || replayAfterConflict.reward_id !== rewardId) {
              throw conflict("requestId already used for a different redemption");
            }
            return {
              redemptionCode: replayAfterConflict.code,
              rewardName: replayAfterConflict.reward_name,
              newBalance: replayAfterConflict.balance_after,
              redemptionId: replayAfterConflict.id,
              pointsCost: replayAfterConflict.points_cost,
              replay: true
            };
          }
          if (i < 4) continue;
        }
        throw e;
      }
    }

    // Capture cost only for this newly completed redemption, in the same
    // transaction as the balance/stock changes. Replays return above unchanged.
    await snapshotCompletedRedemption(client, { businessId: staff.business_id, redemptionId });
    if (typeof deps.completeLegacyProtectedRedemption === "function") {
      await deps.completeLegacyProtectedRedemption(client, { businessId: staff.business_id, staff, customerId, redemptionId, reward, pointsCost: cost, requestId });
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
        { reward_id: rewardId, redemption_id: redemptionId, code, request_id: requestId }
      ]
    );

    if (!deps.deferVisit) await client.query(`UPDATE customers SET last_visit_at=now() WHERE id=$1`, [customerId]);

    return {
      redemptionCode: code,
      rewardName: reward.name,
      newBalance: balanceUpdate.rows[0].points,
      redemptionId,
      pointsCost: cost
    };
  });

  if (!out.replay) {
    deps.enqueueWebhookEvent(staff.business_id, "reward.redeemed", {
      redemption_id: out.redemptionId,
      customer_id: customerId,
      reward_id: rewardId,
      points_cost: out.pointsCost,
      code: out.redemptionCode
    }).catch(() => {});

    await AuditRepo.log({
      id: id(),
      business_id: staff.business_id,
      actor_type: "STAFF",
      actor_id: staff.id,
      action: "reward.redeem",
      ip: null,
      ua: null,
      meta: withImpersonationMeta({
        redemption_id: out.redemptionId,
        reward_id: rewardId,
        customer_id: customerId,
        transaction_request_id: requestId ?? null,
        code: out.redemptionCode,
        points_cost: out.pointsCost
      }, staff)
    }).catch(() => {});
  }

  return {
    redemptionCode: out.redemptionCode,
    redemptionId: out.redemptionId,
    rewardName: out.rewardName,
    newBalance: out.newBalance
  };
}

export async function redeemReward(args) {
  return redeemRewardWithDeps(redeemDeps, args);
}

// Called by the browser route after the redemption transaction has rolled back.
export async function redeemRewardWithRecovery(args, injected = {}) {
  const redeem = injected.redeem ?? redeemReward;
  const record = injected.record ?? recordFailedRedemption;
  try { return await redeem(args); } catch (error) {
    try {
      const recoveryCaseId = await record({ ...args, error });
      if (recoveryCaseId) error.recoveryCaseId = recoveryCaseId;
    } catch { /* Recording must never replace the original redemption error. */ }
    throw error;
  }
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
        offlineGrant: award.offlineGrant,
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
