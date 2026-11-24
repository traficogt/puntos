import { assertRegionAmount, regionCurrency } from "./regional-settings.js";
import crypto from "node:crypto";
import { purchaseEventTime, assertPurchaseTimeReplay } from "./purchase-event-time.js";

import { BusinessRepo } from "../repositories/business-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { verifyQrToken, verifyQrSignature } from "../../utils/qr-token.js";
import { verifyCapturedQr } from "./staff-offline-service.js";
import { computePoints, computePointsWithEvidence } from "./points-service.js";
import { cashbackTerms } from "./cashback-model.js";
import { accrueCashback } from "./cashback-service.js";
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
import { errorMessage, errorStatus } from "../../utils/error-shape.js";

/**
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number | null }> }} StaffAwardQueryClient
 * The staff session as the routes pass it (req.staff).
 * @typedef {{ id: string, business_id: string, branch_id?: string | null, role?: string | null, impersonated_by?: string | null }} StaffAwardActor
 * Business row from BusinessRepo.getById (repositories owner) as the award path reads it.
 * @typedef {{
 *   id: string,
 *   plan?: string | null,
 *   program_type?: string | null,
 *   program_json?: Record<string, any> | null,
 *   reward_promise_cycle_id?: string | null
 * }} StaffAwardBusiness
 * Claims of a verified customer code: a signed QR, an offline-captured QR or a native wallet membership.
 * @typedef {{ bid: string, cid: string, jti: string, exp?: number, iat?: number, passId?: string | null }} StaffAwardDecodedToken
 * @typedef {{ amount_q: number, visits: number, items: number }} StaffAwardRawInput
 * @typedef {{
 *   staff: StaffAwardActor,
 *   customerQrToken: string,
 *   amount_q?: number,
 *   visits?: number,
 *   items?: number,
 *   source?: string,
 *   meta?: Record<string, any>,
 *   txId?: string | null,
 *   offlineGrant?: string | null
 * }} StaffAwardInput
 * @typedef {{
 *   customerQrToken: string,
 *   staff: StaffAwardActor,
 *   txId: string | null,
 *   source: string,
 *   meta: Record<string, any>,
 *   offlineGrant: string | null,
 *   nativeWallet: boolean
 * }} StaffAwardRequest
 * @typedef {{
 *   pointsAwarded: number,
 *   newBalance: number,
 *   newPendingBalance: number,
 *   customerId: string,
 *   transactionId: string,
 *   status: string,
 *   availableAt: Date | string | null,
 *   replay?: boolean
 * }} StaffAwardResult
 * @typedef {{
 *   businessId: string,
 *   customerId: string,
 *   staff: StaffAwardActor,
 *   guardCfg: Record<string, any>,
 *   amountQ: number,
 *   visits: number,
 *   items: number
 * }} StaffAwardGuardInput
 * Everything the locked write path works from (see prepareAward).
 * @typedef {Awaited<ReturnType<typeof prepareAward>>} StaffAwardContext
 * Collaborators. Production wiring is `defaultDeps`; unit tests pass fakes shaped like these
 * members, which is why the lazily loaded services are described by the methods the hooks call
 * rather than by the full modules.
 * @typedef {{
 *   verifyQrToken: (token: string) => Promise<StaffAwardDecodedToken>,
 *   verifyQrSignature?: (token: string) => Promise<StaffAwardDecodedToken>,
 *   verifyCapturedQr?: typeof verifyCapturedQr,
 *   verifyNativeWalletAward?: typeof verifyNativeWalletAward,
 *   BusinessRepo: {
 *     getById: (id: string) => Promise<StaffAwardBusiness | null | undefined>,
 *     activeCustomerCount?: (businessId: string) => Promise<number>
 *   },
 *   computePoints: typeof computePoints,
 *   computePointsWithEvidence?: typeof computePointsWithEvidence,
 *   claimTargetedOffer?: typeof claimTargetedOffer,
 *   protectedEarningBusiness?: typeof protectedEarningBusiness,
 *   getPlanFeatureOverrides?: () => Promise<Record<string, any> | undefined>,
 *   planLimits?: (plan: string) => { activeCustomers?: number },
 *   withTransaction: <T>(fn: (client: StaffAwardQueryClient) => Promise<T>) => Promise<T>,
 *   enqueueWebhookEvent: (businessId: string, event: string, payload: Record<string, unknown>) => Promise<unknown>
 * } & import("./staff-award-hooks.js").StaffAwardHooksDeps} StaffAwardDeps
 */

function id() {
  return crypto.randomUUID();
}

/**
 * @param {StaffAwardQueryClient} client
 * @param {string} businessId
 * @param {string} txId
 */
async function lockAwardRequest(client, businessId, txId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
    String(businessId),
    String(txId),
  ]);
}

/** @param {{ businessId: string, staff: StaffAwardActor, action: string, meta: Record<string, unknown> }} entry */
function logAwardGuardAction({ businessId, staff, action, meta }) {
  return AuditRepo.log({
    id: id(),
    business_id: businessId,
    actor_type: "STAFF",
    actor_id: staff.id,
    action,
    ip: null,
    ua: null,
    meta: withImpersonationMeta(meta, staff),
  }).catch((err) => logger.warn({ err, action }, "Audit log write failed (award guard)"));
}

/**
 * loyalty-ops-service (A–M owner) declares `businessId = null` without JSDoc, so the strict
 * config infers `businessId?: null` although both functions take the tenant id. Typed at
 * this boundary until that module documents its parameters.
 * @typedef {(customerId: string, businessId?: string | null) => Promise<unknown>} StaffAwardSettlementFn
 */
const settlePending = /** @type {StaffAwardSettlementFn} */ (settlePendingPointsForCustomer);
const expirePoints = /** @type {StaffAwardSettlementFn} */ (expirePointsForCustomer);

/** @param {string} customerId @param {string} businessId */
async function settleCustomerPoints(customerId, businessId) {
  if (config.NODE_ENV === "test") return;
  await settlePending(customerId, businessId).catch((err) => {
    logger.warn(
      { err: err?.message, customerId, businessId },
      "settlePendingPointsForCustomer failed",
    );
  });
  await expirePoints(customerId, businessId).catch((err) => {
    logger.warn({ err: err?.message, customerId, businessId }, "expirePointsForCustomer failed");
  });
}

/** @param {StaffAwardGuardInput & { points: number, currency?: string }} guard */
async function enforceAwardGuards({
  businessId,
  customerId,
  staff,
  guardCfg,
  amountQ,
  visits,
  items,
  points,
  currency = "GTQ",
}) {
  const maxAmountQ = Number(guardCfg.max_amount_q ?? 0);
  const maxVisits = Number(guardCfg.max_visits ?? 0);
  const maxItems = Number(guardCfg.max_items ?? 0);
  const maxPointsPerTx = Number(guardCfg.max_points_per_tx ?? 0);

  if (maxAmountQ > 0 && amountQ > maxAmountQ) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_amount_q",
      meta: { amount_q: amountQ, max_amount_q: maxAmountQ, customer_id: customerId },
    });
    throw forbidden(`El monto supera el máximo permitido (${maxAmountQ} ${currency})`);
  }

  if (maxVisits > 0 && visits > maxVisits) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_visits",
      meta: { visits, max_visits: maxVisits, customer_id: customerId },
    });
    throw forbidden(`Las visitas superan el máximo permitido (${maxVisits})`);
  }

  if (maxItems > 0 && items > maxItems) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_items",
      meta: { items, max_items: maxItems, customer_id: customerId },
    });
    throw forbidden(`Los artículos superan el máximo permitido (${maxItems})`);
  }

  if (maxPointsPerTx > 0 && points > maxPointsPerTx) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_points_per_tx",
      meta: { points, max_points_per_tx: maxPointsPerTx, customer_id: customerId },
    });
    throw forbidden(`Los puntos superan el máximo permitido (${maxPointsPerTx})`);
  }
}

/** @type {StaffAwardDeps} */
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
  loadReferralService: () => import("./referral-service.js"),
};

// --- awardPoints phases -----------------------------------------------------

/** @param {{ amount_q?: number | null, visits?: number | null, items?: number | null }} quantities */
function normalizeAwardQuantities({ amount_q, visits, items }) {
  const normalizedVisits = Number.isFinite(Number(visits))
    ? Math.max(0, Math.floor(Number(visits)))
    : 0;
  const normalizedItems = Number.isFinite(Number(items))
    ? Math.max(0, Math.floor(Number(items)))
    : 0;
  const normalizedAmountQ = Number(amount_q ?? 0);
  if (
    !isLedgerAmount(normalizedAmountQ) ||
    !isLedgerInteger(normalizedVisits) ||
    !isLedgerInteger(normalizedItems)
  )
    throw badRequest("El monto o las cantidades no son válidos.");
  return { normalizedAmountQ, normalizedVisits, normalizedItems };
}

// Decodes the customer code (signed QR, offline-captured QR or native wallet
// membership). When a txId is present, a failed verification falls back to a
// receipt-only decode so an already-committed award can still be acknowledged.
/**
 * @param {StaffAwardDeps} typedDeps
 * @param {StaffAwardRequest} request
 * @returns {Promise<{ decoded: StaffAwardDecodedToken, authorizationError: unknown }>}
 */
async function authorizeAwardToken(
  typedDeps,
  { customerQrToken, staff, txId, source, meta, offlineGrant, nativeWallet },
) {
  /** @type {StaffAwardDecodedToken} */
  let decoded;
  /** @type {unknown} */
  let authorizationError = null;
  // txId may be null here; verifyNativeWalletAward rejects that itself (its declared
  // input narrows txId to string, hence the casts below).
  const membershipArgs = {
    token: customerQrToken,
    staff,
    txId,
    source,
    grant: offlineGrant,
    capturedAt: meta.client_ts,
  };
  try {
    decoded = nativeWallet
      ? await (typedDeps.verifyNativeWalletAward ?? verifyNativeWalletAward)(
          /** @type {Parameters<typeof verifyNativeWalletAward>[0]} */ (membershipArgs),
        )
      : source === "offline" && offlineGrant
        ? await (typedDeps.verifyCapturedQr ?? verifyCapturedQr)({
            token: customerQrToken,
            grant: offlineGrant,
            staff,
            capturedAt: meta.client_ts,
          })
        : await typedDeps.verifyQrToken(customerQrToken);
  } catch (e) {
    authorizationError = errorStatus(e)
      ? e
      : badRequest(
          errorMessage(e) ?? "Código QR no válido",
          errorMessage(e) == null ? "VALIDATION_ERROR" : undefined,
        );
    if (!txId) throw authorizationError;
    try {
      decoded = nativeWallet
        ? await (typedDeps.verifyNativeWalletAward ?? verifyNativeWalletAward)(
            /** @type {Parameters<typeof verifyNativeWalletAward>[0]} */ ({
              ...membershipArgs,
              allowRevoked: true,
            }),
          )
        : await (typedDeps.verifyQrSignature ?? verifyQrSignature)(customerQrToken);
    } catch {
      throw authorizationError;
    }
  }
  return { decoded, authorizationError };
}

/**
 * @param {{
 *   bid: string,
 *   cid: string,
 *   staff: StaffAwardActor,
 *   jti: string,
 *   normalizedAmountQ: number,
 *   normalizedVisits: number,
 *   normalizedItems: number
 * }} request
 */
function awardRequestFingerprint({
  bid,
  cid,
  staff,
  jti,
  normalizedAmountQ,
  normalizedVisits,
  normalizedItems,
}) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        bid,
        cid,
        staff.id,
        jti,
        normalizedAmountQ,
        normalizedVisits,
        normalizedItems,
      ]),
    )
    .digest("hex");
}

// Replay lookup for an acknowledged txId. Shared by the pre-authorization probe
// and the locked write path; a mismatching replay is a conflict.
/**
 * @param {StaffAwardQueryClient} client
 * @param {ReturnType<typeof awardReplayContext>} replay
 * @returns {Promise<StaffAwardResult | null>}
 */
async function findExistingAward(client, replay) {
  const { txId, bid, cid, staff, purchaseTime, nativeWallet, requestFingerprint } = replay;
  const found = await client.query(
    `SELECT id, business_id, customer_id, staff_user_id, amount_q, visits, items, points, status, available_at, meta, purchase_occurred_at, purchase_time_source FROM transactions WHERE id=$1 AND business_id=$2`,
    [txId, bid],
  );
  const t = found.rows[0];
  if (!t) return null;
  assertPurchaseTimeReplay(t, purchaseTime.occurredAt);
  const fingerprint = t.meta?.staff_request_fingerprint;
  if (
    t.business_id !== bid ||
    t.customer_id !== cid ||
    t.staff_user_id !== staff.id ||
    Number(t.amount_q) !== replay.normalizedAmountQ ||
    Number(t.visits) !== replay.normalizedVisits ||
    Number(t.items) !== replay.normalizedItems ||
    ((nativeWallet || fingerprint) && fingerprint !== requestFingerprint)
  )
    throw conflict("Este txId ya se usó para otra transacción");
  const bal = await client.query(
    `SELECT points, pending_points FROM customer_balances WHERE customer_id=$1`,
    [cid],
  );
  return {
    pointsAwarded: Number(t.points),
    newBalance: Number(bal.rows[0]?.points ?? 0),
    newPendingBalance: Number(bal.rows[0]?.pending_points ?? 0),
    customerId: cid,
    transactionId: t.id,
    status: t.status,
    availableAt: t.available_at,
    replay: true,
  };
}

/**
 * @param {StaffAwardDeps} typedDeps
 * @param {StaffAwardBusiness} business
 * @param {StaffAwardRawInput} rawInput
 * @param {string} limitMessage
 */
function evaluateAwardPoints(typedDeps, business, rawInput, limitMessage) {
  const evaluated =
    typeof typedDeps.computePointsWithEvidence === "function"
      ? typedDeps.computePointsWithEvidence(business, rawInput)
      : null;
  const points = evaluated ? evaluated.points : typedDeps.computePoints(business, rawInput);
  if (!isLedgerInteger(points)) throw badRequest(limitMessage);
  return { evaluated, points };
}

/**
 * @param {Record<string, any>} guardCfg program_json.award_guard
 * @param {number} points
 * @param {number} normalizedAmountQ
 */
function suspiciousAwardReasons(guardCfg, points, normalizedAmountQ) {
  /** @type {string[]} */
  const suspiciousReasons = [];
  const suspiciousPointsThreshold = Number(guardCfg.suspicious_points_threshold ?? 0);
  const suspiciousAmountThreshold = Number(guardCfg.suspicious_amount_q_threshold ?? 0);
  if (suspiciousPointsThreshold > 0 && points >= suspiciousPointsThreshold)
    suspiciousReasons.push("points_threshold");
  if (suspiciousAmountThreshold > 0 && normalizedAmountQ >= suspiciousAmountThreshold)
    suspiciousReasons.push("amount_threshold");
  return suspiciousReasons;
}

/** @param {string[]} suspiciousReasons @param {number} points @param {number} normalizedAmountQ */
function suspiciousGuardMeta(suspiciousReasons, points, normalizedAmountQ) {
  return {
    suspicious: true,
    reasons: suspiciousReasons,
    points,
    amount_q: normalizedAmountQ,
    flagged_at: new Date().toISOString(),
  };
}

/**
 * @param {{
 *   meta: Record<string, any>,
 *   requestFingerprint: string,
 *   suspiciousReasons: string[],
 *   points: number,
 *   normalizedAmountQ: number
 * }} award
 */
function initialAwardMeta({
  meta,
  requestFingerprint,
  suspiciousReasons,
  points,
  normalizedAmountQ,
}) {
  const storedMeta = { ...meta, staff_request_fingerprint: requestFingerprint };
  return /** @type {Record<string, any>} */ (
    suspiciousReasons.length
      ? {
          ...storedMeta,
          guard: suspiciousGuardMeta(suspiciousReasons, points, normalizedAmountQ),
        }
      : storedMeta
  );
}

/** @param {StaffAwardBusiness} business */
function awardHoldTerms(business) {
  const holdDays = Math.max(
    0,
    Math.floor(Number(business.program_json?.pending_points_hold_days ?? 0)),
  );
  const awardStatus = holdDays > 0 ? "PENDING" : "POSTED";
  const availableAt = holdDays > 0 ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000) : null;
  return { holdDays, awardStatus, availableAt };
}

/** @param {StaffAwardDeps} typedDeps @param {StaffAwardBusiness} business */
async function awardPlanFeatureOverrides(typedDeps, business) {
  return business.program_json?.targeted_offers_enabled === true &&
    typeof typedDeps.getPlanFeatureOverrides === "function"
    ? await typedDeps.getPlanFeatureOverrides()
    : undefined;
}

// Re-reads the business under the earning lock and recomputes points/guards
// against the protected (reward-promise cycle) terms.
/**
 * Only called when the deps provide protectedEarningBusiness (see commitStaffAward).
 * @param {StaffAwardQueryClient} client
 * @param {StaffAwardContext} award
 */
async function protectAwardBusiness(client, award) {
  const { typedDeps, decoded, rawInput, normalizedAmountQ, guardInput, metaForInsert } = award;
  const business = await /** @type {NonNullable<StaffAwardDeps["protectedEarningBusiness"]>} */ (
    typedDeps.protectedEarningBusiness
  )(client, {
    business: award.business,
    customerId: decoded.cid,
  });
  assertRegionAmount(normalizedAmountQ, regionCurrency(business), business);
  const { evaluated, points } = evaluateAwardPoints(
    typedDeps,
    business,
    rawInput,
    "Los puntos calculados exceden el límite permitido.",
  );
  await enforceAwardGuards({ ...guardInput, currency: regionCurrency(business), points });
  if (business.reward_promise_cycle_id)
    metaForInsert.reward_promise_cycle_id = business.reward_promise_cycle_id;
  return { business, evaluated, points };
}

/**
 * @param {StaffAwardQueryClient} client
 * @param {{ decoded: StaffAwardDecodedToken, staff: StaffAwardActor }} token
 */
async function insertQrTokenOnce(client, { decoded, staff }) {
  const { bid, cid, jti, exp } = decoded;
  const insQr = await client.query(
    `INSERT INTO qr_tokens (jti, business_id, customer_id, expires_at)
       VALUES ($1,$2,$3,to_timestamp($4))
       ON CONFLICT (jti) DO NOTHING
       RETURNING jti`,
    [jti, bid, cid, exp],
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
      meta: withImpersonationMeta({ customer_id: cid, jti }, staff),
    }).catch((err) => logger.warn({ err, jti }, "Audit log write failed (award replay)"));
    throw conflict("Este código QR ya se usó (protección contra repetición)");
  }
}

/**
 * @param {StaffAwardQueryClient} client
 * @param {StaffAwardContext} award
 * @param {StaffAwardBusiness} business
 * @param {number} points
 */
async function applyTargetedOfferBonus(client, award, business, points) {
  const { typedDeps, decoded, source, transactionId, planFeatureOverrides } = award;
  const { guardCfg, guardInput, suspiciousReasons, metaForInsert, normalizedAmountQ } = award;
  const bonus =
    typeof typedDeps.claimTargetedOffer === "function"
      ? await typedDeps.claimTargetedOffer({
          client,
          business,
          customerId: decoded.cid,
          transactionId,
          source,
          amountQ: normalizedAmountQ,
          visits: award.normalizedVisits,
          items: award.normalizedItems,
          basePoints: points,
          planFeatureOverrides,
        })
      : { bonusPoints: 0 };
  const awardedPoints = points + bonus.bonusPoints;
  if (!isLedgerInteger(awardedPoints))
    throw badRequest("Los puntos calculados exceden el límite permitido.");
  if (bonus.bonusPoints) {
    await enforceAwardGuards({
      ...guardInput,
      currency: regionCurrency(business),
      points: awardedPoints,
    });
    const suspiciousPointsThreshold = Number(guardCfg.suspicious_points_threshold ?? 0);
    if (
      suspiciousPointsThreshold > 0 &&
      awardedPoints >= suspiciousPointsThreshold &&
      !suspiciousReasons.includes("points_threshold")
    ) {
      suspiciousReasons.push("points_threshold");
    }
    if (suspiciousReasons.length)
      metaForInsert.guard = suspiciousGuardMeta(
        suspiciousReasons,
        awardedPoints,
        normalizedAmountQ,
      );
  }
  return { bonus, awardedPoints };
}

/**
 * @param {StaffAwardQueryClient} client
 * @param {StaffAwardContext} award
 * @param {number} awardedPoints
 */
async function insertAwardTransaction(client, award, awardedPoints) {
  const { staff, decoded, source, transactionId, awardStatus, availableAt, metaForInsert } = award;
  await client.query(
    `INSERT INTO transactions (id, business_id, branch_id, customer_id, staff_user_id, amount_q, visits, items, points, status, available_at, source, meta, purchase_occurred_at, purchase_time_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      transactionId,
      decoded.bid,
      staff.branch_id ?? null,
      decoded.cid,
      staff.id,
      award.normalizedAmountQ,
      award.normalizedVisits,
      award.normalizedItems,
      awardedPoints,
      awardStatus,
      availableAt,
      source,
      metaForInsert,
      award.purchaseTime.occurredAt,
      award.purchaseTime.source,
    ],
  );
}

/**
 * @param {StaffAwardQueryClient} client
 * @param {{ cid: string, awardedPoints: number, awardStatus: string }} credit
 */
async function creditAwardBalance(client, { cid, awardedPoints, awardStatus }) {
  const balUpd = await client.query(
    `UPDATE customer_balances
       SET points = points + CASE WHEN $3 = 'POSTED' THEN $2 ELSE 0 END,
           pending_points = pending_points + CASE WHEN $3 = 'PENDING' THEN $2 ELSE 0 END,
           lifetime_points = lifetime_points + CASE WHEN $3 = 'POSTED' THEN GREATEST($2,0) ELSE 0 END,
           updated_at=now()
       WHERE customer_id=$1
       RETURNING points, pending_points`,
    [cid, awardedPoints, awardStatus],
  );
  if (balUpd.rowCount !== 1) throw notFound("No se encontró el saldo del cliente");
  return balUpd;
}

/**
 * @param {StaffAwardQueryClient} client
 * @param {{ passId: string | null | undefined, bid: string, cid: string }} membership
 */
async function assertNativeWalletMembership(client, { passId, bid, cid }) {
  // Balance triggers lock passes too. Follow their balance-then-pass order
  // to avoid a lock upgrade deadlock between concurrent purchases. A revoked
  // membership rolls back this entire transaction, including the balance.
  const membership = await client.query(
    `SELECT id FROM native_wallet_passes
         WHERE id=$1 AND business_id=$2 AND customer_id=$3 AND revoked_at IS NULL
         FOR SHARE`,
    [passId, bid, cid],
  );
  if (!membership.rows.length)
    throw forbidden("La membresía fue revocada o ya no está disponible.");
}

/**
 * @param {StaffAwardQueryClient} client
 * @param {StaffAwardContext} award
 * @param {StaffAwardBusiness} business
 */
async function accrueAwardCashback(client, award, business) {
  const { decoded, staff, normalizedAmountQ, transactionId, awardStatus } = award;
  if (business.program_type === "CASHBACK" && awardStatus === "POSTED") {
    const cashback = cashbackTerms(business, { amount_q: normalizedAmountQ });
    if (cashback && cashback.earn_q > 0) {
      await accrueCashback(client, {
        businessId: decoded.bid,
        customerId: decoded.cid,
        staffUserId: staff.id,
        amountQ: normalizedAmountQ,
        earnQ: cashback.earn_q,
        sourceTransactionId: transactionId,
        requestId: transactionId,
        meta: { percent: cashback.percent, source: "staff_award" },
      });
    }
  }
}

// The locked write path: replay check, customer/QR/membership checks, ledger
// insert and balance credit in one transaction.
/**
 * @param {StaffAwardQueryClient} client
 * @param {StaffAwardContext} award
 * @returns {Promise<StaffAwardResult>}
 */
async function commitStaffAward(client, award) {
  const { typedDeps, staff, decoded, source, meta, txId, transactionId } = award;
  const { awardStatus, availableAt } = award;
  const { bid, cid } = decoded;
  let { business, evaluated, points } = award;

  await lockAwardRequest(client, bid, transactionId);
  const existing = txId ? await findExistingAward(client, award.replay) : null;
  if (existing) return existing;

  const cust = await client.query(
    `SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL`,
    [cid, bid],
  );
  if (!cust.rows.length) throw notFound("Cliente no encontrado");

  if (typeof typedDeps.protectedEarningBusiness === "function")
    ({ business, evaluated, points } = await protectAwardBusiness(client, award));

  await insertQrTokenOnce(client, { decoded, staff });

  const { bonus, awardedPoints } = await applyTargetedOfferBonus(client, award, business, points);

  award.metaForInsert.award_evidence = completeAwardEvidence(evaluated?.evidence, {
    bonus,
    holdDays: award.holdDays,
    status: awardStatus,
    availableAt,
    source,
    capturedAt: meta.client_ts,
  });

  await insertAwardTransaction(client, award, awardedPoints);
  const balUpd = await creditAwardBalance(client, { cid, awardedPoints, awardStatus });

  if (award.nativeWallet)
    await assertNativeWalletMembership(client, { passId: decoded.passId, bid, cid });

  await client.query(`UPDATE customers SET last_visit_at=now() WHERE id=$1`, [cid]);
  await refreshCustomerDerivedState(client, cid);

  await accrueAwardCashback(client, award, business);

  return {
    pointsAwarded: awardedPoints,
    newBalance: balUpd.rows[0].points,
    newPendingBalance: balUpd.rows[0].pending_points,
    customerId: cid,
    transactionId,
    status: awardStatus,
    availableAt,
  };
}

// Post-commit side effects for a newly created award (never for replays).
/** @param {StaffAwardContext} award @param {StaffAwardResult} result */
async function publishAwardOutcome(award, result) {
  const { typedDeps, staff, decoded, suspiciousReasons, normalizedAmountQ } = award;
  const { bid, cid } = decoded;
  await typedDeps
    .enqueueWebhookEvent(bid, "points.awarded", {
      transaction_id: result.transactionId,
      customer_id: cid,
      points: result.pointsAwarded,
      amount_q: normalizedAmountQ,
    })
    .catch((err) =>
      logger.warn(
        { err, transactionId: result.transactionId },
        "Webhook enqueue failed after award",
      ),
    );

  await AuditRepo.log({
    id: id(),
    business_id: bid,
    actor_type: "STAFF",
    actor_id: staff.id,
    action: suspiciousReasons.length ? "award.suspicious" : "award.success",
    ip: null,
    ua: null,
    meta: withImpersonationMeta(
      {
        transaction_id: result.transactionId,
        customer_id: cid,
        points: result.pointsAwarded,
        amount_q: normalizedAmountQ,
        suspicious_reasons: suspiciousReasons,
      },
      staff,
    ),
  }).catch((err) =>
    logger.warn({ err, transactionId: result.transactionId }, "Audit log write failed (award)"),
  );

  // Complete dependent ledger work before the HTTP request releases its
  // tenant-scoped database client. Detached work could use a released client.
  await runPostAwardHooks({
    deps: typedDeps,
    customerId: cid,
    businessId: bid,
    sourceTransactionId: result.transactionId,
    pointsAwarded: result.pointsAwarded,
    amountQ: normalizedAmountQ,
    visits: award.normalizedVisits,
    items: award.normalizedItems,
  });
}

// Everything findExistingAward needs to recognise (or reject) a replayed txId.
/**
 * @param {{
 *   staff: StaffAwardActor,
 *   txId: string | null,
 *   decoded: StaffAwardDecodedToken,
 *   purchaseTime: ReturnType<typeof purchaseEventTime>,
 *   nativeWallet: boolean,
 *   quantities: ReturnType<typeof normalizeAwardQuantities>
 * }} context
 */
function awardReplayContext({ staff, txId, decoded, purchaseTime, nativeWallet, quantities }) {
  const { bid, cid, jti } = decoded;
  return {
    ...quantities,
    txId,
    bid,
    cid,
    staff,
    purchaseTime,
    nativeWallet,
    requestFingerprint: awardRequestFingerprint({ bid, cid, staff, jti, ...quantities }),
  };
}

// Computes points, guards, suspicious flags, hold terms and the insert meta for
// a new award and returns the context the locked write path works from.
/**
 * @param {StaffAwardDeps} typedDeps
 * @param {StaffAwardBusiness} business
 * @param {StaffAwardRequest & ReturnType<typeof normalizeAwardQuantities> & {
 *   decoded: StaffAwardDecodedToken,
 *   purchaseTime: ReturnType<typeof purchaseEventTime>,
 *   replay: ReturnType<typeof awardReplayContext>,
 *   rawInput: StaffAwardRawInput
 * }} ctx
 */
async function prepareAward(typedDeps, business, ctx) {
  const { decoded, staff, meta, txId, rawInput, replay } = ctx;
  const { normalizedAmountQ, normalizedVisits, normalizedItems } = ctx;
  const { evaluated, points } = evaluateAwardPoints(
    typedDeps,
    business,
    rawInput,
    "Los puntos calculados exceden el límite permitido. Revisa la configuración del programa.",
  );
  const guardCfg = business.program_json?.award_guard ?? {};
  const guardInput = {
    businessId: decoded.bid,
    customerId: decoded.cid,
    staff,
    guardCfg,
    amountQ: normalizedAmountQ,
    visits: normalizedVisits,
    items: normalizedItems,
  };
  await enforceAwardGuards({ ...guardInput, currency: regionCurrency(business), points });

  const suspiciousReasons = suspiciousAwardReasons(guardCfg, points, normalizedAmountQ);
  const metaForInsert = initialAwardMeta({
    meta,
    requestFingerprint: replay.requestFingerprint,
    suspiciousReasons,
    points,
    normalizedAmountQ,
  });
  const hold = awardHoldTerms(business);
  const transactionId = txId ?? id();
  const planFeatureOverrides = await awardPlanFeatureOverrides(typedDeps, business);
  return {
    ...ctx,
    ...hold,
    typedDeps,
    business,
    evaluated,
    points,
    guardCfg,
    guardInput,
    suspiciousReasons,
    metaForInsert,
    transactionId,
    planFeatureOverrides,
  };
}

/**
 * @param {StaffAwardDeps} deps
 * @param {StaffAwardInput} input
 */
export async function awardPointsWithDeps(
  deps,
  {
    staff,
    customerQrToken,
    amount_q = 0,
    visits = 0,
    items = 0,
    source = "online",
    meta = /** @type {Record<string, any>} */ ({}),
    txId = null,
    offlineGrant = null,
  },
) {
  const typedDeps = deps;
  const quantities = normalizeAwardQuantities({ amount_q, visits, items });
  const purchaseTime = purchaseEventTime(
    source === "offline" ? meta.client_ts : null,
    "client_reported",
  );

  const nativeWallet = isNativeWalletCode(customerQrToken);
  if (nativeWallet && typeof txId === "string") txId = txId.toLowerCase();
  const request = { customerQrToken, staff, txId, source, meta, offlineGrant, nativeWallet };
  const { decoded, authorizationError } = await authorizeAwardToken(typedDeps, request);

  const { bid, cid } = decoded;
  if (bid !== staff.business_id) throw forbidden("El código QR pertenece a otro negocio");

  const replay = awardReplayContext({ ...request, decoded, purchaseTime, quantities });
  // A committed transaction remains acknowledgeable after QR/grant expiry or
  // membership revocation. Receipt-only authorization can never create a row.
  if (txId) {
    const existing = await typedDeps.withTransaction((client) => findExistingAward(client, replay));
    if (existing) return existing;
  }
  if (authorizationError) throw authorizationError;

  const business = await typedDeps.BusinessRepo.getById(bid);
  if (!business) throw notFound("Negocio no encontrado");

  await settleCustomerPoints(cid, bid);

  // Active-customer plan limits are a soft, billing-side cap: never block a scan at the
  // counter. Earning always proceeds; upgrade pressure is surfaced to the owner out-of-band,
  // not as a failed award in front of a waiting customer.
  const award = await prepareAward(typedDeps, business, {
    ...request,
    ...quantities,
    decoded,
    purchaseTime,
    replay,
    rawInput: { amount_q, visits, items },
  });
  const result = await typedDeps.withTransaction((client) => commitStaffAward(client, award));

  if (!result.replay) await publishAwardOutcome(award, result);

  logger.info(
    {
      transactionId: result.transactionId,
      businessId: bid,
      customerId: cid,
      staffId: staff.id,
      pointsAwarded: result.pointsAwarded,
      amountQ: quantities.normalizedAmountQ,
      status: result.status,
    },
    "Staff award completed",
  );

  return result;
}

/** @param {StaffAwardInput} args */
export async function awardPoints(args) {
  return awardPointsWithDeps(defaultDeps, args);
}
