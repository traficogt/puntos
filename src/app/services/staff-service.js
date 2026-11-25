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
import {
  settlePendingPointsForCustomer,
  expirePointsForCustomer,
  refundAwardTransaction,
} from "./loyalty-ops-service.js";
import { enqueueWebhookEvent } from "./webhook-service.js";
import { awardPoints, awardPointsWithDeps } from "./staff-award-service.js";
import { logger } from "../../utils/logger.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { hashPassword, needsPasswordRehash, verifyPassword } from "../../utils/password-hash.js";
import { verifyQrToken } from "../../utils/qr-token.js";
import { verifyStaffMfaForLogin } from "./account-security-service.js";
import { isNativeWalletCode, resolveNativeWalletMembership } from "./native-wallet/membership.js";
import { recordFailedRedemption } from "./service-recovery-service.js";
import {
  protectedRedemptionReward,
  completeLegacyProtectedRedemption,
  lockProtectedRedemptionBusiness,
  protectedRedemptionName,
} from "./reward-promise-service.js";
import { snapshotCompletedRedemption } from "./reward-economics-service.js";
import { assertNoPendingCheckout } from "./pos-checkout-guard.js";
import { assertRewardInventory } from "./reward-inventory-service.js";
import { errorCode, errorMessage, errorStatus, isErrorLike } from "../../utils/error-shape.js";

/**
 * @typedef {import("../../types/db.js").DbQueryClient} StaffServiceQueryClient
 * The staff session as the routes pass it (req.staff).
 * @typedef {{ id: string, business_id: string, branch_id?: string | null, role?: string | null, impersonated_by?: string | null }} StaffServiceActor
 * Business row from BusinessRepo.getById (repositories owner) as redemption reads it; this
 * module only reads program_json, and an integration fixture returns just that.
 * @typedef {{ id?: string, slug?: string, plan?: string | null, program_type?: string | null, program_json?: Record<string, any> | null }} StaffServiceBusiness
 * Customer row from CustomerRepo.getById (repositories owner) as the lookup reads it.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name?: string | null,
 *   phone?: string | null,
 *   points?: number | string | null,
 *   pending_points?: number | string | null,
 *   deleted_at?: Date | string | null
 * }} StaffServiceCustomer
 * A rewards row, plus the promise-protected fields reward-promise-service may add.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   points_cost: number | string,
 *   active?: boolean,
 *   stock?: number | null,
 *   valid_until?: Date | string | null,
 *   protected_branch_ids?: string[] | null,
 *   [column: string]: unknown
 * }} StaffServiceReward
 * The columns findExistingRedemptionByRequestId selects for a replayed requestId.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   customer_id: string,
 *   reward_id: string,
 *   code: string,
 *   points_cost: number,
 *   balance_after: number,
 *   reward_name: string
 * }} StaffServiceRedemptionReplayRow
 * @typedef {{ staff: StaffServiceActor, customerId: string, rewardId: string, requestId?: string | null }} StaffServiceRedeemArgs
 * @typedef {{
 *   staff: StaffServiceActor,
 *   customerId: string,
 *   rewardId: string,
 *   requestId: string | null,
 *   business: StaffServiceBusiness,
 *   limits: ReturnType<typeof redemptionGuardLimits>
 * }} StaffServiceRedemption
 * @typedef {{
 *   redemptionCode: string,
 *   rewardName: string,
 *   newBalance: number,
 *   redemptionId: string,
 *   pointsCost: number,
 *   replay?: boolean
 * }} StaffServiceRedeemOutcome
 * One award captured offline by the scanner and synced later.
 * @typedef {{
 *   txId?: string | null,
 *   customerQrToken: string,
 *   amount_q?: number | null,
 *   visits?: number,
 *   items?: number,
 *   offlineGrant?: string | null,
 *   meta?: Record<string, any> | null,
 *   client_ts?: string | null
 * }} StaffServiceOfflineAward
 * @typedef {{
 *   verifyQrToken: (token: string) => Promise<{ bid: string, cid: string }>,
 *   resolveNativeWalletMembership?: typeof resolveNativeWalletMembership,
 *   CustomerRepo: { getById: (id: string) => Promise<StaffServiceCustomer | null | undefined> }
 * }} StaffServiceLookupDeps
 * Redemption collaborators. Production wiring is `redeemDeps`; checkout and unit tests
 * substitute members, so each is typed by what this module uses.
 * @typedef {{
 *   BusinessRepo: { getById: (id: string) => Promise<StaffServiceBusiness | null | undefined> },
 *   RewardRepo: { listBranchIds: (rewardId: string) => Promise<string[]> },
 *   withTransaction: <T>(fn: (client: StaffServiceQueryClient) => Promise<T>) => Promise<T>,
 *   settlePendingPointsForCustomer: (customerId: string, businessId: string) => Promise<unknown>,
 *   expirePointsForCustomer: (customerId: string, businessId: string) => Promise<unknown>,
 *   enqueueWebhookEvent: (businessId: string, event: string, payload: Record<string, unknown>) => Promise<unknown>,
 *   protectedRedemptionReward?: typeof protectedRedemptionReward,
 *   lockProtectedRedemptionBusiness?: typeof lockProtectedRedemptionBusiness,
 *   protectedRedemptionName?: typeof protectedRedemptionName,
 *   completeLegacyProtectedRedemption?: typeof completeLegacyProtectedRedemption | null,
 *   deferVisit?: boolean
 * }} StaffServiceRedeemDeps
 */

function id() {
  return crypto.randomUUID();
}

/**
 * @param {StaffServiceLookupDeps} deps
 * @param {{ staff: StaffServiceActor, customerQrToken: string }} lookup
 */
export async function lookupCustomerByQrTokenWithDeps(deps, { staff, customerQrToken }) {
  let decoded;
  try {
    decoded = isNativeWalletCode(customerQrToken)
      ? await (deps.resolveNativeWalletMembership ?? resolveNativeWalletMembership)({
          token: customerQrToken,
          staff,
        })
      : await deps.verifyQrToken(customerQrToken);
  } catch (error) {
    if (isNativeWalletCode(customerQrToken) && errorStatus(error)) throw error;
    throw badRequest(
      errorMessage(error) ?? "Código QR no válido",
      errorMessage(error) == null ? "VALIDATION_ERROR" : undefined,
    );
  }

  const { bid, cid } = decoded;
  if (bid !== staff.business_id) throw forbidden("El código QR pertenece a otro negocio");

  const customer = await deps.CustomerRepo.getById(cid);
  if (!customer || customer.business_id !== staff.business_id || customer.deleted_at)
    throw notFound("Cliente no encontrado");

  return {
    customer: {
      id: customer.id,
      name: customer.name ?? null,
      phone: customer.phone ?? null,
      points: Number(customer.points ?? 0),
      pending_points: Number(customer.pending_points ?? 0),
    },
  };
}

/**
 * @param {StaffServiceQueryClient} client
 * @param {string} businessId
 * @param {string | null | undefined} requestId
 * @returns {Promise<StaffServiceRedemptionReplayRow | null>}
 */
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
    [businessId, requestId],
  );
  return rows[0] ?? null;
}

/**
 * @param {StaffServiceQueryClient} client
 * @param {string} businessId
 * @param {string | null | undefined} requestId
 */
async function lockRedemptionRequest(client, businessId, requestId) {
  if (!requestId) return;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
    String(businessId),
    String(requestId),
  ]);
}

/** @param {{ email: string, password: string, mfaCode?: string | null }} credentials */
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
      meta: { email: String(email || "").toLowerCase(), reason: "not_found_or_inactive" },
    }).catch((err) => logger.warn({ err }, "Security event write failed (staff_login_failed)"));
    throw unauthorized("Credenciales inválidas", "VALIDATION_ERROR");
  }

  await setCurrentTenant(String(loginRow.business_id));
  const staff = (await StaffRepo.getById(loginRow.id)) || loginRow;

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
      meta: { email: String(email || "").toLowerCase(), reason: "wrong_password" },
    }).catch((err) => logger.warn({ err }, "Security event write failed (staff_login_failed)"));
    throw unauthorized("Credenciales inválidas", "VALIDATION_ERROR");
  }

  if (needsPasswordRehash(staff.password_hash)) {
    const upgradedHash = await hashPassword(password);
    await dbQuery(
      `UPDATE staff_users
          SET password_hash = $2
        WHERE id = $1`,
      [staff.id, upgradedHash],
    ).catch((err) =>
      logger.warn({ err, staffId: staff.id }, "Password hash upgrade failed; login continues"),
    );
  }

  const mfaResult = await verifyStaffMfaForLogin(staff, mfaCode);

  const token = await signStaffToken({
    sid: staff.id,
    bid: staff.business_id,
    role: staff.role,
    brid: staff.branch_id ?? null,
    mfaVerified: Boolean(mfaResult?.mfaVerified),
  });
  return {
    staff: {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      business_id: staff.business_id,
      branch_id: staff.branch_id,
    },
    token,
  };
}

/** @type {StaffServiceLookupDeps} */
const customerLookupDeps = {
  verifyQrToken,
  resolveNativeWalletMembership,
  CustomerRepo,
};

/** @param {{ staff: StaffServiceActor, customerQrToken: string }} payload */
export async function lookupCustomerByQrToken(payload) {
  return lookupCustomerByQrTokenWithDeps(customerLookupDeps, payload);
}

/**
 * loyalty-ops-service (A–M owner) declares `businessId = null` without JSDoc, so the strict
 * config infers `businessId?: null` although both functions take the tenant id. Typed at
 * this boundary until that module documents its parameters.
 * @typedef {(
 *   customerId: string,
 *   businessId?: string | null,
 *   transaction?: <T>(fn: (client: StaffServiceQueryClient) => Promise<T>) => Promise<T>
 * ) => Promise<unknown>} StaffServiceSettlementFn
 */
const settlePending = /** @type {StaffServiceSettlementFn} */ (settlePendingPointsForCustomer);
const expirePoints = /** @type {StaffServiceSettlementFn} */ (expirePointsForCustomer);

/** @type {StaffServiceRedeemDeps} */
const redeemDeps = {
  BusinessRepo,
  RewardRepo,
  withTransaction,
  settlePendingPointsForCustomer: settlePending,
  expirePointsForCustomer: expirePoints,
  enqueueWebhookEvent,
  protectedRedemptionReward,
  lockProtectedRedemptionBusiness,
  protectedRedemptionName,
  completeLegacyProtectedRedemption,
};

// Checkout owns the transaction and completes the earned terms on paid receipt.
/**
 * @param {StaffServiceQueryClient} client
 * @param {StaffServiceRedeemArgs} payload
 * @param {StaffServiceRedeemDeps["completeLegacyProtectedRedemption"]} captureCompletion
 */
export async function redeemCheckoutWithinTransaction(client, payload, captureCompletion) {
  // Settlement can lock the balance; retain business → reward → balance order.
  await client.query("SELECT id FROM businesses WHERE id=$1 FOR SHARE", [
    payload.staff.business_id,
  ]);
  await client.query("SELECT id FROM rewards WHERE business_id=$1 AND id=$2 FOR UPDATE", [
    payload.staff.business_id,
    payload.rewardId,
  ]);
  return redeemRewardWithDeps(
    {
      ...redeemDeps,
      withTransaction: (fn) => fn(client),
      settlePendingPointsForCustomer: (customerId, businessId) =>
        settlePending(customerId, businessId, (fn) => fn(client)),
      expirePointsForCustomer: (customerId, businessId) =>
        expirePoints(customerId, businessId, (fn) => fn(client)),
      enqueueWebhookEvent: async () => {},
      deferVisit: true,
      completeLegacyProtectedRedemption: captureCompletion,
    },
    payload,
  );
}

// --- redeemReward phases ----------------------------------------------------

/**
 * @param {StaffServiceRedeemDeps} deps
 * @param {string} customerId
 * @param {string} businessId
 */
async function settleBeforeRedemption(deps, customerId, businessId) {
  await deps
    .settlePendingPointsForCustomer(customerId, businessId)
    .catch((err) =>
      logger.warn({ err, customerId }, "Pending points settlement failed before redemption"),
    );
  await deps
    .expirePointsForCustomer(customerId, businessId)
    .catch((err) => logger.warn({ err, customerId }, "Points expiry failed before redemption"));
}

/** @param {StaffServiceBusiness} business */
function redemptionGuardLimits(business) {
  const redemptionGuard = business.program_json?.redemption_guard ?? {};
  const maxRedemptionsPerDay = Math.max(
    0,
    Math.floor(Number(redemptionGuard.max_redemptions_per_day ?? 0)),
  );
  const maxRewardRedemptionsPerDay = Math.max(
    0,
    Math.floor(Number(redemptionGuard.max_reward_redemptions_per_day ?? 0)),
  );
  const rewardCooldownHours = Math.max(
    0,
    Math.floor(Number(redemptionGuard.reward_cooldown_hours ?? 0)),
  );
  return { maxRedemptionsPerDay, maxRewardRedemptionsPerDay, rewardCooldownHours };
}

/**
 * @param {StaffServiceRedemptionReplayRow} replay
 * @returns {StaffServiceRedeemOutcome}
 */
function replayRedemptionResult(replay) {
  return {
    redemptionCode: replay.code,
    rewardName: replay.reward_name,
    newBalance: replay.balance_after,
    redemptionId: replay.id,
    pointsCost: replay.points_cost,
    replay: true,
  };
}

// Returns the already-completed redemption for an acknowledged requestId, or
// null when this request has not been seen before.
/**
 * @param {StaffServiceQueryClient} client
 * @param {StaffServiceRedeemDeps} deps
 * @param {StaffServiceRedemption} redemption
 */
async function replayExistingRedemption(client, deps, { staff, customerId, rewardId, requestId }) {
  const replay = await findExistingRedemptionByRequestId(client, staff.business_id, requestId);
  if (!replay) return null;
  if (typeof deps.protectedRedemptionName === "function")
    replay.reward_name =
      (await deps.protectedRedemptionName(client, replay.id)) ?? replay.reward_name;
  if (replay.customer_id !== customerId || replay.reward_id !== rewardId) {
    throw conflict("Este requestId ya se usó para otro canje");
  }
  await AuditRepo.log({
    id: id(),
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    action: "reward.redeem.replay",
    ip: null,
    ua: null,
    meta: withImpersonationMeta(
      {
        redemption_id: replay.id,
        reward_id: rewardId,
        customer_id: customerId,
        request_id: requestId ?? null,
        code: replay.code,
      },
      staff,
    ),
  }).catch((err) =>
    logger.warn({ err, redemptionId: replay.id }, "Audit log write failed (reward.redeem.replay)"),
  );
  logger.info(
    {
      businessId: staff.business_id,
      customerId,
      rewardId,
      requestId,
      redemptionId: replay.id,
      staffId: staff.id,
      replay: true,
    },
    "Staff redeem replay returned existing redemption",
  );
  return replayRedemptionResult(replay);
}

// Locks business → reward (then the pending-checkout guard) and validates the
// reward is redeemable by this business right now.
/**
 * @param {StaffServiceQueryClient} client
 * @param {StaffServiceRedeemDeps} deps
 * @param {StaffServiceRedemption} redemption
 */
async function lockRedeemableReward(client, deps, { staff, business, customerId, rewardId }) {
  const lockedBusiness =
    typeof deps.lockProtectedRedemptionBusiness === "function"
      ? await deps.lockProtectedRedemptionBusiness(client, staff.business_id)
      : business;
  const redemptionTimezone = regionTimezone(lockedBusiness ?? business);
  const rewardResult = await client.query(`SELECT * FROM rewards WHERE id=$1 FOR UPDATE`, [
    rewardId,
  ]);
  /** @type {StaffServiceReward | undefined} */
  let reward = rewardResult.rows[0];
  if (
    reward &&
    reward.business_id === staff.business_id &&
    typeof deps.protectedRedemptionReward === "function"
  ) {
    reward = await deps.protectedRedemptionReward(client, {
      businessId: staff.business_id,
      customerId,
      reward,
    });
  }
  await assertNoPendingCheckout(client, { business: lockedBusiness ?? business, customerId });
  if (!reward || !reward.active) throw notFound("La recompensa no está disponible");
  if (reward.business_id !== staff.business_id)
    throw forbidden("La recompensa pertenece a otro negocio");
  if (reward.valid_until && new Date(reward.valid_until) < new Date()) {
    throw badRequest("La recompensa venció");
  }
  return { lockedBusiness, redemptionTimezone, reward };
}

/**
 * @param {StaffServiceRedeemDeps} deps
 * @param {{ staff: StaffServiceActor, reward: StaffServiceReward, rewardId: string }} scope
 */
async function assertRewardBranchScope(deps, { staff, reward, rewardId }) {
  const scopedBranches =
    reward.protected_branch_ids ?? (await deps.RewardRepo.listBranchIds(rewardId));
  if (scopedBranches.length > 0) {
    if (!staff.branch_id || !scopedBranches.includes(String(staff.branch_id))) {
      throw forbidden("La recompensa no está disponible en esta sucursal");
    }
  }
}

/**
 * @param {StaffServiceQueryClient} client
 * @param {{ staff: StaffServiceActor, customerId: string, rewardId: string, business: StaffServiceBusiness }} redemption
 */
async function lockRedeemingCustomer(client, { staff, customerId, rewardId, business }) {
  const customerResult = await client.query(
    `SELECT id
       FROM customers
       WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL
       FOR SHARE`,
    [customerId, staff.business_id],
  );
  if (!customerResult.rows.length) throw notFound("Cliente no encontrado");
  if (business.program_json?.pos_inventory_checks === true) {
    await assertRewardInventory(client, {
      businessId: staff.business_id,
      rewardId,
      branchId: staff.branch_id ?? null,
    });
  }
}

/**
 * @param {StaffServiceQueryClient} client
 * @param {{
 *   staff: StaffServiceActor,
 *   customerId: string,
 *   rewardId: string,
 *   redemptionTimezone: string,
 *   limits: ReturnType<typeof redemptionGuardLimits>
 * }} redemption
 */
async function enforceRedemptionGuards(
  client,
  { staff, customerId, rewardId, redemptionTimezone, limits },
) {
  const { maxRedemptionsPerDay, maxRewardRedemptionsPerDay, rewardCooldownHours } = limits;
  if (maxRedemptionsPerDay > 0) {
    const daily = await client.query(
      `SELECT COUNT(*)::int AS c
         FROM redemptions
         WHERE business_id = $1
           AND status <> 'CANCELLED'
           AND customer_id = $2
           AND created_at >= (date_trunc('day', now() AT TIME ZONE $3) AT TIME ZONE $3)`,
      [staff.business_id, customerId, redemptionTimezone],
    );
    if (Number(daily.rows?.[0]?.c ?? 0) >= maxRedemptionsPerDay) {
      throw conflict(`Se alcanzó el límite diario de canjes (${maxRedemptionsPerDay} por día)`);
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
      [staff.business_id, customerId, rewardId, redemptionTimezone],
    );
    if (Number(daily.rows?.[0]?.c ?? 0) >= maxRewardRedemptionsPerDay) {
      throw conflict(
        `Se alcanzó el límite diario de esta recompensa (${maxRewardRedemptionsPerDay} por día)`,
      );
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
      [staff.business_id, customerId, rewardId],
    );
    const last = latest.rows?.[0]?.created_at ? new Date(latest.rows[0].created_at) : null;
    if (last) {
      const sinceHours = (Date.now() - last.getTime()) / (1000 * 60 * 60);
      if (sinceHours < rewardCooldownHours) {
        const wait = Math.ceil(rewardCooldownHours - sinceHours);
        throw conflict(
          `Esta recompensa tiene un tiempo de espera entre canjes. Intenta de nuevo en ~${wait} h.`,
        );
      }
    }
  }
}

/**
 * @param {StaffServiceQueryClient} client
 * @param {string} customerId
 * @param {number} cost
 */
async function debitRedemptionBalance(client, customerId, cost) {
  const balanceUpdate = await client.query(
    `UPDATE customer_balances
       SET points = points - $2,
           updated_at=now()
       WHERE customer_id=$1 AND points >= $2
       RETURNING points`,
    [customerId, cost],
  );
  if (balanceUpdate.rowCount !== 1) throw conflict("Puntos insuficientes");
  return balanceUpdate;
}

/**
 * @param {StaffServiceQueryClient} client
 * @param {StaffServiceReward} reward
 * @param {string} rewardId
 */
async function decrementRewardStock(client, reward, rewardId) {
  if (reward.stock !== null && reward.stock !== undefined) {
    const stockUpdate = await client.query(
      `UPDATE rewards SET stock = stock - 1
         WHERE id=$1 AND stock > 0
         RETURNING stock`,
      [rewardId],
    );
    if (stockUpdate.rowCount !== 1) throw conflict("La recompensa no tiene existencias");
  }
}

// Inserts the redemption with a fresh code, retrying on code collisions. A
// unique violation that turns out to be a concurrent replay of this requestId
// yields that redemption instead of a new row.
/**
 * @param {StaffServiceQueryClient} client
 * @param {{
 *   staff: StaffServiceActor,
 *   customerId: string,
 *   rewardId: string,
 *   requestId: string | null,
 *   redemptionId: string,
 *   cost: number,
 *   balanceAfter: number
 * }} redemption
 */
async function insertRedemptionRow(
  client,
  { staff, customerId, rewardId, requestId, redemptionId, cost, balanceAfter },
) {
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
          balanceAfter,
        ],
      );
      break;
    } catch (e) {
      if (String(errorCode(e)) === "23505") {
        const replayAfterConflict = await findExistingRedemptionByRequestId(
          client,
          staff.business_id,
          requestId,
        );
        if (replayAfterConflict) {
          if (
            replayAfterConflict.customer_id !== customerId ||
            replayAfterConflict.reward_id !== rewardId
          ) {
            throw conflict("Este requestId ya se usó para otro canje");
          }
          return { code: "", replay: replayRedemptionResult(replayAfterConflict) };
        }
        if (i < 4) continue;
      }
      throw e;
    }
  }
  return { code, replay: null };
}

/**
 * @param {StaffServiceQueryClient} client
 * @param {StaffServiceRedeemDeps} deps
 * @param {{
 *   staff: StaffServiceActor,
 *   customerId: string,
 *   rewardId: string,
 *   requestId: string | null,
 *   redemptionId: string,
 *   reward: StaffServiceReward,
 *   cost: number,
 *   code: string
 * }} redemption
 */
async function recordRedemptionLedger(
  client,
  deps,
  { staff, customerId, rewardId, requestId, redemptionId, reward, cost, code },
) {
  // Capture cost only for this newly completed redemption, in the same
  // transaction as the balance/stock changes. Replays return above unchanged.
  await snapshotCompletedRedemption(client, { businessId: staff.business_id, redemptionId });
  if (typeof deps.completeLegacyProtectedRedemption === "function") {
    await deps.completeLegacyProtectedRedemption(client, {
      businessId: staff.business_id,
      staff,
      customerId,
      redemptionId,
      reward,
      pointsCost: cost,
      requestId,
    });
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
      { reward_id: rewardId, redemption_id: redemptionId, code, request_id: requestId },
    ],
  );

  if (!deps.deferVisit)
    await client.query(`UPDATE customers SET last_visit_at=now() WHERE id=$1`, [customerId]);
}

// The locked write path: replay check, business → reward → customer locks,
// guards, balance debit, stock, redemption row and ledger entry.
/**
 * @param {StaffServiceQueryClient} client
 * @param {StaffServiceRedeemDeps} deps
 * @param {StaffServiceRedemption} redemption
 * @returns {Promise<StaffServiceRedeemOutcome>}
 */
async function commitRedemption(client, deps, redemption) {
  const { staff, customerId, rewardId, requestId, business, limits } = redemption;
  await lockRedemptionRequest(client, staff.business_id, requestId);
  const replay = await replayExistingRedemption(client, deps, redemption);
  if (replay) return replay;

  const { lockedBusiness, redemptionTimezone, reward } = await lockRedeemableReward(
    client,
    deps,
    redemption,
  );
  await assertRewardBranchScope(deps, { staff, reward, rewardId });
  await lockRedeemingCustomer(client, {
    staff,
    customerId,
    rewardId,
    business: lockedBusiness ?? business,
  });
  await enforceRedemptionGuards(client, {
    staff,
    customerId,
    rewardId,
    redemptionTimezone,
    limits,
  });

  const cost = Number(reward.points_cost);
  const balanceUpdate = await debitRedemptionBalance(client, customerId, cost);
  await decrementRewardStock(client, reward, rewardId);

  const redemptionId = id();
  const inserted = await insertRedemptionRow(client, {
    staff,
    customerId,
    rewardId,
    requestId,
    redemptionId,
    cost,
    balanceAfter: balanceUpdate.rows[0].points,
  });
  if (inserted.replay) return inserted.replay;
  const { code } = inserted;

  await recordRedemptionLedger(client, deps, {
    staff,
    customerId,
    rewardId,
    requestId,
    redemptionId,
    reward,
    cost,
    code,
  });

  return {
    redemptionCode: code,
    rewardName: reward.name,
    newBalance: balanceUpdate.rows[0].points,
    redemptionId,
    pointsCost: cost,
  };
}

// Post-commit side effects for a newly created redemption (never for replays).
// The webhook enqueue is fire-and-forget; the audit write is awaited.
/**
 * @param {StaffServiceRedeemDeps} deps
 * @param {StaffServiceRedemption} redemption
 * @param {StaffServiceRedeemOutcome} out
 */
async function publishRedemption(deps, { staff, customerId, rewardId, requestId }, out) {
  deps
    .enqueueWebhookEvent(staff.business_id, "reward.redeemed", {
      redemption_id: out.redemptionId,
      customer_id: customerId,
      reward_id: rewardId,
      points_cost: out.pointsCost,
      code: out.redemptionCode,
    })
    .catch((err) =>
      logger.warn(
        { err, redemptionId: out.redemptionId },
        "Webhook enqueue failed (reward.redeemed)",
      ),
    );

  await AuditRepo.log({
    id: id(),
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    action: "reward.redeem",
    ip: null,
    ua: null,
    meta: withImpersonationMeta(
      {
        redemption_id: out.redemptionId,
        reward_id: rewardId,
        customer_id: customerId,
        transaction_request_id: requestId ?? null,
        code: out.redemptionCode,
        points_cost: out.pointsCost,
      },
      staff,
    ),
  }).catch((err) =>
    logger.warn({ err, redemptionId: out.redemptionId }, "Audit log write failed (reward.redeem)"),
  );
}

/**
 * @param {StaffServiceRedeemDeps} deps
 * @param {StaffServiceRedeemArgs} args
 */
export async function redeemRewardWithDeps(
  deps,
  { staff, customerId, rewardId, requestId = null },
) {
  const business = await deps.BusinessRepo.getById(staff.business_id);
  if (!business) throw notFound("Negocio no encontrado");

  await settleBeforeRedemption(deps, customerId, staff.business_id);

  const redemption = {
    staff,
    customerId,
    rewardId,
    requestId,
    business,
    limits: redemptionGuardLimits(business),
  };
  const out = await deps.withTransaction((client) => commitRedemption(client, deps, redemption));

  if (!out.replay) await publishRedemption(deps, redemption, out);

  return {
    redemptionCode: out.redemptionCode,
    redemptionId: out.redemptionId,
    rewardName: out.rewardName,
    newBalance: out.newBalance,
  };
}

/** @param {StaffServiceRedeemArgs} args */
export async function redeemReward(args) {
  return redeemRewardWithDeps(redeemDeps, args);
}

// Called by the browser route after the redemption transaction has rolled back.
/**
 * Forwards the route's validated redemption body without validating it again;
 * the recovery unit tests call it with `{}` and injected fakes.
 * @param {Partial<StaffServiceRedeemArgs>} args
 * @param {{ redeem?: typeof redeemReward, record?: typeof recordFailedRedemption }} [injected]
 */
export async function redeemRewardWithRecovery(args, injected = {}) {
  const redeem = injected.redeem ?? redeemReward;
  const record = injected.record ?? recordFailedRedemption;
  const redemption = /** @type {StaffServiceRedeemArgs} */ (args);
  try {
    return await redeem(redemption);
  } catch (error) {
    try {
      const recoveryCaseId = await record({ ...redemption, error });
      if (recoveryCaseId && isErrorLike(error)) error.recoveryCaseId = recoveryCaseId;
    } catch {
      /* Recording must never replace the original redemption error. */
    }
    throw error;
  }
}

/** @param {{ staff: StaffServiceActor, awards: StaffServiceOfflineAward[] }} batch */
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
        txId: award.txId,
      });
      results.push({ txId: award.txId, ok: true, result });
    } catch (e) {
      results.push({ txId: award.txId, ok: false, error: errorMessage(e) ?? String(e) });
    }
  }
  return results;
}

/** @param {{ staff: StaffServiceActor, transactionId: string, requestId: string, reason?: string }} args */
export async function refundAward(args) {
  return refundAwardTransaction(args);
}

export { awardPoints, awardPointsWithDeps };
