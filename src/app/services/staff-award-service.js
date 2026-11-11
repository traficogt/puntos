import { assertRegionAmount, regionCurrency } from "./regional-settings.js";
import crypto from "node:crypto";

import { BusinessRepo } from "../repositories/business-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { verifyQrToken, verifyQrSignature } from "../../utils/qr-token.js";
import { verifyCapturedQr } from "./staff-offline-service.js";
import { computePoints, computePointsWithEvidence } from "./points-service.js";
import { completeAwardEvidence } from "./transaction-rule-evidence.js";
import { enqueueWebhookEvent } from "./webhook-service.js";
import { planLimits } from "../../utils/plan.js";
import { withTransaction } from "../database.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { settlePendingPointsForCustomer, expirePointsForCustomer } from "./loyalty-ops-service.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { PlanConfigService } from "./plan-config-service.js";
import { claimTargetedOffer } from "./targeted-offer-service.js";
import { runPostAwardHooks } from "./staff-award-hooks.js";
import { refreshCustomerDerivedState } from "./customer-derived-state.js";
import { isLedgerInteger, isLedgerAmount } from "../../utils/ledger-limits.js";
import { protectedEarningBusiness } from "./reward-promise-service.js";
import { isNativeWalletCode, verifyNativeWalletAward } from "./native-wallet/membership.js";

function id() {
  return crypto.randomUUID();
}

async function lockAwardRequest(client, businessId, txId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(businessId), String(txId)]
  );
}

function logAwardGuardAction({ businessId, staff, action, meta }) {
  return AuditRepo.log({
    id: id(),
    business_id: businessId,
    actor_type: "STAFF",
    actor_id: staff.id,
    action,
    ip: null,
    ua: null,
    meta: withImpersonationMeta(meta, staff)
  }).catch(() => {});
}

async function settleCustomerPoints(customerId, businessId) {
  if (config.NODE_ENV === "test") return;
  await settlePendingPointsForCustomer(customerId, businessId).catch((err) => {
    logger.warn({ err: err?.message, customerId, businessId }, "settlePendingPointsForCustomer failed");
  });
  await expirePointsForCustomer(customerId, businessId).catch((err) => {
    logger.warn({ err: err?.message, customerId, businessId }, "expirePointsForCustomer failed");
  });
}

async function enforceAwardGuards({ businessId, customerId, staff, guardCfg, amountQ, visits, items, points, currency="GTQ" }) {
  const maxAmountQ = Number(guardCfg.max_amount_q ?? 0);
  const maxVisits = Number(guardCfg.max_visits ?? 0);
  const maxItems = Number(guardCfg.max_items ?? 0);
  const maxPointsPerTx = Number(guardCfg.max_points_per_tx ?? 0);

  if (maxAmountQ > 0 && amountQ > maxAmountQ) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_amount_q",
      meta: { amount_q: amountQ, max_amount_q: maxAmountQ, customer_id: customerId }
    });
    throw forbidden(`El monto supera el máximo permitido (${maxAmountQ} ${currency})`);
  }

  if (maxVisits > 0 && visits > maxVisits) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_visits",
      meta: { visits, max_visits: maxVisits, customer_id: customerId }
    });
    throw forbidden(`Visits exceed max allowed (${maxVisits})`);
  }

  if (maxItems > 0 && items > maxItems) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_items",
      meta: { items, max_items: maxItems, customer_id: customerId }
    });
    throw forbidden(`Items exceed max allowed (${maxItems})`);
  }

  if (maxPointsPerTx > 0 && points > maxPointsPerTx) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_points_per_tx",
      meta: { points, max_points_per_tx: maxPointsPerTx, customer_id: customerId }
    });
    throw forbidden(`Points exceed max allowed (${maxPointsPerTx})`);
  }
}

const defaultDeps = {
  verifyQrToken,
  verifyQrSignature,
  verifyCapturedQr,
  verifyNativeWalletAward,
  BusinessRepo,
  computePoints,
  computePointsWithEvidence,
  claimTargetedOffer,
  protectedEarningBusiness,
  getPlanFeatureOverrides: () => PlanConfigService.getPlanFeatureOverrides(),
  planLimits,
  withTransaction,
  enqueueWebhookEvent,
  loadTierService: () => import("./tier-service.js"),
  loadGamificationService: () => import("./gamification-service.js"),
  loadReferralService: () => import("./referral-service.js")
};

export async function awardPointsWithDeps(
  deps,
  { staff, customerQrToken, amount_q = 0, visits = 0, items = 0, source = "online", meta = /** @type {Record<string, any>} */ ({}), txId = null, offlineGrant = null }
) {
  const typedDeps = deps;
  const normalizedVisits = Number.isFinite(Number(visits)) ? Math.max(0, Math.floor(Number(visits))) : 0;
  const normalizedItems = Number.isFinite(Number(items)) ? Math.max(0, Math.floor(Number(items))) : 0;
  const normalizedAmountQ = Number(amount_q ?? 0);
  if (!isLedgerAmount(normalizedAmountQ) || !isLedgerInteger(normalizedVisits) || !isLedgerInteger(normalizedItems)) throw badRequest("El monto o las cantidades no son válidos.");

  let decoded;
  let authorizationError = null;
  const nativeWallet = isNativeWalletCode(customerQrToken);
  if (nativeWallet && typeof txId === "string") txId = txId.toLowerCase();
  const membershipArgs = { token: customerQrToken, staff, txId, source, grant: offlineGrant, capturedAt: meta.client_ts };
  try {
    decoded = nativeWallet
      ? await (typedDeps.verifyNativeWalletAward ?? verifyNativeWalletAward)(membershipArgs)
      : source === "offline" && offlineGrant
        ? await (typedDeps.verifyCapturedQr ?? verifyCapturedQr)({ token: customerQrToken, grant: offlineGrant, staff, capturedAt: meta.client_ts })
        : await typedDeps.verifyQrToken(customerQrToken);
  } catch (e) {
    authorizationError = e?.statusCode ? e : badRequest(e?.message ?? "Invalid QR token");
    if (!txId) throw authorizationError;
    try {
      decoded = nativeWallet
        ? await (typedDeps.verifyNativeWalletAward ?? verifyNativeWalletAward)({ ...membershipArgs, allowRevoked: true })
        : await (typedDeps.verifyQrSignature ?? verifyQrSignature)(customerQrToken);
    }
    catch { throw authorizationError; }
  }

  const { bid, cid, jti, exp } = decoded;
  if (bid !== staff.business_id) throw forbidden("QR token is for a different business");

  const requestFingerprint = crypto.createHash("sha256")
    .update(JSON.stringify([bid, cid, staff.id, jti, normalizedAmountQ, normalizedVisits, normalizedItems])).digest("hex");
  async function existingAward(client) {
    const found = await client.query(`SELECT id, business_id, customer_id, staff_user_id, amount_q, visits, items, points, status, available_at, meta FROM transactions WHERE id=$1 AND business_id=$2`, [txId, bid]);
    const t = found.rows[0];
    if (!t) return null;
    const fingerprint = t.meta?.staff_request_fingerprint;
    if (t.business_id !== bid || t.customer_id !== cid || t.staff_user_id !== staff.id || Number(t.amount_q) !== normalizedAmountQ || Number(t.visits) !== normalizedVisits || Number(t.items) !== normalizedItems || ((nativeWallet || fingerprint) && fingerprint !== requestFingerprint)) throw conflict("txId already used for a different transaction payload");
    const bal = await client.query(`SELECT points, pending_points FROM customer_balances WHERE customer_id=$1`, [cid]);
    return { pointsAwarded: Number(t.points), newBalance: Number(bal.rows[0]?.points ?? 0), newPendingBalance: Number(bal.rows[0]?.pending_points ?? 0), customerId: cid, transactionId: t.id, status: t.status, availableAt: t.available_at, replay: true };
  }
  // A committed transaction remains acknowledgeable after QR/grant expiry or
  // membership revocation. Receipt-only authorization can never create a row.
  if (txId) {
    const existing = await typedDeps.withTransaction(existingAward);
    if (existing) return existing;
  }
  if (authorizationError) throw authorizationError;

  let business = await typedDeps.BusinessRepo.getById(bid);
  if (!business) throw notFound("Business not found");

  await settleCustomerPoints(cid, bid);

  const limits = typedDeps.planLimits(business.plan);
  const activeCount = await typedDeps.BusinessRepo.activeCustomerCount(bid);
  if (activeCount > limits.activeCustomers) throw forbidden("Plan limit: active customers exceeded");

  let evaluated = typeof typedDeps.computePointsWithEvidence === "function"
    ? typedDeps.computePointsWithEvidence(business, { amount_q, visits, items }) : null;
  let points = evaluated ? evaluated.points : typedDeps.computePoints(business, { amount_q, visits, items });
  if (!isLedgerInteger(points)) throw badRequest("Los puntos calculados exceden el límite permitido. Revisa la configuración del programa.");
  const guardCfg = business.program_json?.award_guard ?? {};

  await enforceAwardGuards({
    businessId: bid,
    customerId: cid,
    staff,
    guardCfg, currency: regionCurrency(business),
    amountQ: normalizedAmountQ,
    visits: normalizedVisits,
    items: normalizedItems,
    points
  });

  const suspiciousReasons = [];
  const suspiciousPointsThreshold = Number(guardCfg.suspicious_points_threshold ?? 0);
  const suspiciousAmountThreshold = Number(guardCfg.suspicious_amount_q_threshold ?? 0);
  if (suspiciousPointsThreshold > 0 && points >= suspiciousPointsThreshold) suspiciousReasons.push("points_threshold");
  if (suspiciousAmountThreshold > 0 && normalizedAmountQ >= suspiciousAmountThreshold) suspiciousReasons.push("amount_threshold");

  const storedMeta = { ...meta, staff_request_fingerprint: requestFingerprint };
  const metaForInsert = /** @type {Record<string, any>} */ (suspiciousReasons.length
    ? {
        ...storedMeta,
        guard: {
          suspicious: true,
          reasons: suspiciousReasons,
          points,
          amount_q: normalizedAmountQ,
          flagged_at: new Date().toISOString()
        }
      }
    : storedMeta);

  const holdDays = Math.max(0, Math.floor(Number(business.program_json?.pending_points_hold_days ?? 0)));
  const awardStatus = holdDays > 0 ? "PENDING" : "POSTED";
  const availableAt = holdDays > 0 ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000) : null;
  const transactionId = txId ?? id();

  const planFeatureOverrides = business.program_json?.targeted_offers_enabled === true && typeof typedDeps.getPlanFeatureOverrides === "function"
    ? await typedDeps.getPlanFeatureOverrides() : undefined;
  const result = await typedDeps.withTransaction(async (client) => {
    await lockAwardRequest(client, bid, transactionId);
    const existing = txId ? await existingAward(client) : null;
    if (existing) return existing;

    const cust = await client.query(
      `SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL`,
      [cid, bid]
    );
    if (!cust.rows.length) throw notFound("Customer not found");

    if (typeof typedDeps.protectedEarningBusiness === "function") {
      business = await typedDeps.protectedEarningBusiness(client, { business, customerId: cid });
      assertRegionAmount(normalizedAmountQ, regionCurrency(business), business);
      evaluated = typeof typedDeps.computePointsWithEvidence === "function"
        ? typedDeps.computePointsWithEvidence(business, { amount_q, visits, items }) : null;
      points = evaluated ? evaluated.points : typedDeps.computePoints(business, { amount_q, visits, items });
      if (!isLedgerInteger(points)) throw badRequest("Los puntos calculados exceden el límite permitido.");
      await enforceAwardGuards({ businessId: bid, customerId: cid, staff, guardCfg, currency: regionCurrency(business),
        amountQ: normalizedAmountQ, visits: normalizedVisits, items: normalizedItems, points });
      if (business.reward_promise_cycle_id) metaForInsert.reward_promise_cycle_id = business.reward_promise_cycle_id;
    }

    const insQr = await client.query(
      `INSERT INTO qr_tokens (jti, business_id, customer_id, expires_at)
       VALUES ($1,$2,$3,to_timestamp($4))
       ON CONFLICT (jti) DO NOTHING
       RETURNING jti`,
      [jti, bid, cid, exp]
    );
    if (insQr.rowCount !== 1) {
      await SecurityEventRepo.log({
        event_type: "qr_replay_blocked",
        severity: "HIGH",
        route: "/api/staff/award",
        method: "POST",
        business_id: bid,
        actor_type: "STAFF",
        actor_id: staff.id,
        meta: withImpersonationMeta({ customer_id: cid, jti }, staff)
      }).catch(() => {});
      throw conflict("QR token already used (replay protection)");
    }

    const bonus = typeof typedDeps.claimTargetedOffer === "function"
      ? await typedDeps.claimTargetedOffer({ client, business, customerId: cid, transactionId, source,
        amountQ: normalizedAmountQ, visits: normalizedVisits, items: normalizedItems, basePoints: points, planFeatureOverrides })
      : { bonusPoints: 0 };
    const awardedPoints = points + bonus.bonusPoints;
    if (!isLedgerInteger(awardedPoints)) throw badRequest("Los puntos calculados exceden el límite permitido.");
    if (bonus.bonusPoints) {
      await enforceAwardGuards({ businessId: bid, customerId: cid, staff, guardCfg, currency: regionCurrency(business),
        amountQ: normalizedAmountQ, visits: normalizedVisits, items: normalizedItems, points: awardedPoints });
      if (suspiciousPointsThreshold > 0 && awardedPoints >= suspiciousPointsThreshold && !suspiciousReasons.includes("points_threshold")) {
        suspiciousReasons.push("points_threshold");
      }
      if (suspiciousReasons.length) metaForInsert.guard = { suspicious: true, reasons: suspiciousReasons,
        points: awardedPoints, amount_q: normalizedAmountQ, flagged_at: new Date().toISOString() };
    }

    metaForInsert.award_evidence = completeAwardEvidence(evaluated?.evidence, {
      bonus, holdDays, status: awardStatus, availableAt, source, capturedAt: meta.client_ts
    });

    await client.query(
      `INSERT INTO transactions (id, business_id, branch_id, customer_id, staff_user_id, amount_q, visits, items, points, status, available_at, source, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        transactionId,
        bid,
        staff.branch_id ?? null,
        cid,
        staff.id,
        normalizedAmountQ,
        normalizedVisits,
        normalizedItems,
        awardedPoints,
        awardStatus,
        availableAt,
        source,
        metaForInsert
      ]
    );

    const balUpd = await client.query(
      `UPDATE customer_balances
       SET points = points + CASE WHEN $3 = 'POSTED' THEN $2 ELSE 0 END,
           pending_points = pending_points + CASE WHEN $3 = 'PENDING' THEN $2 ELSE 0 END,
           lifetime_points = lifetime_points + CASE WHEN $3 = 'POSTED' THEN GREATEST($2,0) ELSE 0 END,
           updated_at=now()
       WHERE customer_id=$1
       RETURNING points, pending_points`,
      [cid, awardedPoints, awardStatus]
    );
    if (balUpd.rowCount !== 1) throw notFound("Customer balance not found");

    if (nativeWallet) {
      // Balance triggers lock passes too. Follow their balance-then-pass order
      // to avoid a lock upgrade deadlock between concurrent purchases. A revoked
      // membership rolls back this entire transaction, including the balance.
      const membership = await client.query(
        `SELECT id FROM native_wallet_passes
         WHERE id=$1 AND business_id=$2 AND customer_id=$3 AND revoked_at IS NULL
         FOR SHARE`,
        [decoded.passId, bid, cid]
      );
      if (!membership.rows.length) throw forbidden("La membresía fue revocada o ya no está disponible.");
    }

    await client.query(`UPDATE customers SET last_visit_at=now() WHERE id=$1`, [cid]);
    await refreshCustomerDerivedState(client, cid);

    return {
      pointsAwarded: awardedPoints,
      newBalance: balUpd.rows[0].points,
      newPendingBalance: balUpd.rows[0].pending_points,
      customerId: cid,
      transactionId,
      status: awardStatus,
      availableAt
    };
  });

  if (!result.replay) {
    await typedDeps.enqueueWebhookEvent(bid, "points.awarded", {
      transaction_id: result.transactionId,
      customer_id: cid,
      points: result.pointsAwarded,
      amount_q: normalizedAmountQ
    }).catch(() => {});

    await AuditRepo.log({
      id: id(),
      business_id: bid,
      actor_type: "STAFF",
      actor_id: staff.id,
      action: suspiciousReasons.length ? "award.suspicious" : "award.success",
      ip: null,
      ua: null,
      meta: withImpersonationMeta({
        transaction_id: result.transactionId,
        customer_id: cid,
        points: result.pointsAwarded,
        amount_q: normalizedAmountQ,
        suspicious_reasons: suspiciousReasons
      }, staff)
    }).catch(() => {});

    // Complete dependent ledger work before the HTTP request releases its
    // tenant-scoped database client. Detached work could use a released client.
    await runPostAwardHooks({
      deps: typedDeps,
      customerId: cid,
      businessId: bid,
      sourceTransactionId: result.transactionId,
      pointsAwarded: result.pointsAwarded,
      amountQ: normalizedAmountQ,
      visits: normalizedVisits,
      items: normalizedItems
    });
  }

  logger.info({
    transactionId: result.transactionId,
    businessId: bid,
    customerId: cid,
    staffId: staff.id,
    pointsAwarded: result.pointsAwarded,
    amountQ: normalizedAmountQ,
    status: result.status
  }, "Staff award completed");

  return result;
}

export async function awardPoints(args) {
  return awardPointsWithDeps(defaultDeps, args);
}
