import { assertRegionAmount, regionCurrency } from "./regional-settings.js";
import crypto from "node:crypto";
import { withTransaction, setCurrentTenant } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { PlanConfigService } from "./plan-config-service.js";
import { claimTargetedOffer } from "./targeted-offer-service.js";
import { computePoints, computePointsWithEvidence } from "./points-service.js";
import { protectedEarningBusiness } from "./reward-promise-service.js";
import { completeAwardEvidence } from "./transaction-rule-evidence.js";
import { badRequest, forbidden, notFound, conflict } from "../../utils/http-error.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";
import { isLedgerAmount, isLedgerInteger } from "../../utils/ledger-limits.js";

function id() { return crypto.randomUUID(); }

function hashPayload(prefix, payload) {
  return crypto
    .createHash("sha256")
    .update(`${prefix}:${JSON.stringify(payload)}`)
    .digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function buildExternalAwardFingerprint({ customerId, amountQ, visits, items, meta }) {
  // Program settings and the resulting ledger status are not part of the sale.
  return `v2:${hashPayload("external-award-v2", {
    customerId: String(customerId || ""),
    amountQ: Number(amountQ || 0),
    visits: Number(visits || 0),
    items: Number(items || 0),
    meta: canonicalValue(meta && typeof meta === "object" ? meta : {})
  })}`;
}

function storedRequestFingerprint(existing) {
  if ([existing.amount_q, existing.visits, existing.items].some((value) => value == null)) return null;
  // Older hashes depended on JSON key order, which JSONB does not preserve.
  // Compare their persisted sale fields instead of recomputing that lossy hash.
  const meta = Object.fromEntries(Object.entries(existing.meta || {}).filter(([key]) => (
    key !== "external_event_id" && key !== "external_request_fingerprint"
  )));
  return buildExternalAwardFingerprint({
    customerId: existing.customer_id,
    amountQ: existing.amount_q,
    visits: existing.visits,
    items: existing.items,
    meta
  });
}

/**
 * @typedef {{
 *   withTransaction: <T>(fn: (client: { query: (...args: any[]) => Promise<any> }) => Promise<T>) => Promise<T>,
 *   setCurrentTenant: (tenantId: string) => Promise<void>,
 *   BusinessRepo: {
 *     getPublicBySlug: (slug: string) => Promise<{ id: string } | null>,
 *     getById: (id: string) => Promise<{ id: string, program_json?: Record<string, any>, reward_promise_cycle_id?: string } | null>
 *   },
 *   CustomerRepo: {
 *     getById: (customerId: string) => Promise<{ id: string, business_id: string } | null>,
 *     getByBusinessAndPhone: (businessId: string, phone: string) => Promise<{ id: string, business_id: string } | null>
 *   },
 *   computePoints: (business: any, values: { amount_q?: number, visits?: number, items?: number }) => number,
 *   computePointsWithEvidence?: typeof computePointsWithEvidence,
 *   claimTargetedOffer?: typeof claimTargetedOffer,
 *   protectedEarningBusiness?: typeof protectedEarningBusiness,
 *   getPlanFeatureOverrides?: () => Promise<Record<string, any>>,
 *   timingSafeEqualString: (left: string, right: string) => boolean
 * }} ExternalAwardDeps
 *
 * @typedef {{
 *   businessSlug: string,
 *   apiKey?: string,
 *   externalEventId: string,
 *   customerId?: string,
 *   customerPhone?: string,
 *   amount_q?: number,
 *   visits?: number,
 *   items?: number,
 *   meta?: Record<string, unknown>,
 *   expectedCurrency?: string,
 *   skipApiKeyCheck?: boolean
 * }} ExternalAwardInput
 */

async function lockExternalEventRequest(client, businessId, externalEventId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(businessId), String(externalEventId)]
  );
}

async function findExistingExternalEventTransaction(client, businessId, externalEventId) {
  const { rows } = await client.query(
    `SELECT id, customer_id, amount_q, visits, items, points, status, available_at, meta
     FROM transactions
     WHERE business_id = $1
       AND source = 'external'
       AND meta->>'external_event_id' = $2
     LIMIT 1`,
    [businessId, String(externalEventId)]
  );
  return rows[0] ?? null;
}

/**
 * @param {ExternalAwardDeps} deps
 * @param {ExternalAwardInput} args
 */
export async function awardFromExternalEventWithDeps(deps, {
  businessSlug,
  apiKey,
  externalEventId,
  customerId,
  customerPhone,
  amount_q = 0,
  visits = 0,
  items = 0,
  meta = {},
  expectedCurrency,
  skipApiKeyCheck = false
}) {
  const publicBiz = await deps.BusinessRepo.getPublicBySlug(businessSlug);
  if (!publicBiz) throw notFound("Business not found");
  await deps.setCurrentTenant(String(publicBiz.id));
  let business = await deps.BusinessRepo.getById(String(publicBiz.id));
  if (!business) throw notFound("Business not found");
  // Carry the adapter denomination separately: changing legacy metadata would
  // invalidate existing request fingerprints. Freeze the fallback before locking.
  const posCurrency = meta?.pos_sale && typeof meta.pos_sale === "object" ? (meta.pos_sale["currency"] ?? "GTQ") : undefined;
  const settlementCurrency = expectedCurrency ?? posCurrency ?? regionCurrency(business);
  const ext = business.program_json?.external_awards ?? {};
  if (!ext.enabled) throw forbidden("External awards are disabled");
  if (!skipApiKeyCheck && (!apiKey || !deps.timingSafeEqualString(apiKey, ext.api_key))) throw forbidden("Invalid API key");
  if (!externalEventId || String(externalEventId).length < 4) throw badRequest("externalEventId required");
  if (!isLedgerAmount(amount_q)) {
    throw badRequest("Amount must fit the ledger money column with at most two decimal places");
  }
  for (const quantity of [visits, items]) {
    if (!isLedgerInteger(quantity)) throw badRequest("Quantities must be non-negative ledger integers");
  }

  let customer = null;
  if (customerId) customer = await deps.CustomerRepo.getById(customerId);
  if (!customer && customerPhone) customer = await deps.CustomerRepo.getByBusinessAndPhone(business.id, customerPhone);
  if (!customer || customer.business_id !== business.id) throw notFound("Customer not found for this business");

  let evaluated = typeof deps.computePointsWithEvidence === "function"
    ? deps.computePointsWithEvidence(business, { amount_q, visits, items }) : null;
  let points = evaluated ? evaluated.points : deps.computePoints(business, { amount_q, visits, items });
  const holdDays = Math.max(0, Math.floor(Number(business.program_json?.pending_points_hold_days ?? 0)));
  const status = holdDays > 0 ? "PENDING" : "POSTED";
  const availableAt = holdDays > 0 ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000) : null;
  const requestFingerprint = buildExternalAwardFingerprint({
    customerId: customer.id,
    amountQ: amount_q,
    visits,
    items,
    meta
  });

  const planFeatureOverrides = business.program_json?.targeted_offers_enabled === true && typeof deps.getPlanFeatureOverrides === "function"
    ? await deps.getPlanFeatureOverrides() : undefined;
  return deps.withTransaction(async (client) => {
    await lockExternalEventRequest(client, business.id, externalEventId);
    const existing = await findExistingExternalEventTransaction(client, business.id, externalEventId);
    if (existing) {
      const existingMeta = existing.meta && typeof existing.meta === "object" ? existing.meta : {};
      const existingFingerprint = String(existingMeta.external_request_fingerprint || "");
      const comparisonFingerprint = existingFingerprint.startsWith("v2:")
        ? existingFingerprint
        : storedRequestFingerprint(existing);
      if (existing.customer_id !== customer.id) {
        throw conflict("externalEventId already used for a different customer");
      }
      if (comparisonFingerprint && comparisonFingerprint !== requestFingerprint) {
        throw conflict("externalEventId already used for a different payload");
      }
      if (!comparisonFingerprint && (existingFingerprint || Number(existing.points || 0) !== Number(points) || String(existing.status || "") !== status)) {
        throw conflict("externalEventId already used for a different payload");
      }
      await AuditRepo.log({
        id: id(),
        business_id: business.id,
        actor_type: "SYSTEM",
        actor_id: null,
        action: "external_award.replay",
        ip: null,
        ua: null,
        meta: {
          transaction_id: existing.id,
          customer_id: customer.id,
          external_event_id: String(externalEventId)
        }
      }).catch(() => {});
      return {
        ok: true,
        transactionId: existing.id,
        customerId: customer.id,
        pointsAwarded: Number(existing.points || 0),
        status: existing.status,
        availableAt: existing.available_at,
        replay: true
      };
    }

    if (typeof deps.protectedEarningBusiness === "function") {
      business = await deps.protectedEarningBusiness(client, { business, customerId: customer.id });
      assertRegionAmount(amount_q, settlementCurrency, business);
      evaluated = typeof deps.computePointsWithEvidence === "function"
        ? deps.computePointsWithEvidence(business, { amount_q, visits, items }) : null;
      points = evaluated ? evaluated.points : deps.computePoints(business, { amount_q, visits, items });
    }

    if (!isLedgerInteger(points)) {
      throw badRequest("Computed points must be a non-negative ledger integer");
    }
    const txId = id();
    const bonus = typeof deps.claimTargetedOffer === "function"
      ? await deps.claimTargetedOffer({ client, business, customerId: customer.id, transactionId: txId,
        source: "external", amountQ: Number(amount_q), visits, items, basePoints: points, planFeatureOverrides })
      : { bonusPoints: 0 };
    const awardedPoints = points + bonus.bonusPoints;
    if (!isLedgerInteger(awardedPoints)) throw badRequest("Computed points must be a non-negative ledger integer");
    await client.query(
      `INSERT INTO transactions
       (id, business_id, customer_id, amount_q, visits, items, points, status, available_at, source, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'external',$10)`,
      [
        txId,
        business.id,
        customer.id,
        Number(amount_q || 0),
        Math.max(0, Math.floor(Number(visits || 0))),
        Math.max(0, Math.floor(Number(items || 0))),
        awardedPoints,
        status,
        availableAt,
        {
          ...meta,
          ...(business.reward_promise_cycle_id ? { reward_promise_cycle_id: business.reward_promise_cycle_id } : {}),
          external_event_id: String(externalEventId),
          external_request_fingerprint: requestFingerprint,
          award_evidence: completeAwardEvidence(evaluated?.evidence, { bonus, holdDays, status, availableAt, source: "external" })
        }
      ]
    );

    const balanceUpdate = await client.query(
      `UPDATE customer_balances
       SET points = points + CASE WHEN $3 = 'POSTED' THEN $2 ELSE 0 END,
           pending_points = pending_points + CASE WHEN $3 = 'PENDING' THEN $2 ELSE 0 END,
           lifetime_points = lifetime_points + CASE WHEN $3 = 'POSTED' THEN GREATEST($2,0) ELSE 0 END,
           updated_at = now()
       WHERE customer_id = $1`,
      [customer.id, awardedPoints, status]
    );
    if (balanceUpdate.rowCount !== 1) throw conflict("Customer balance is unavailable; award was not applied");

    return { ok: true, transactionId: txId, customerId: customer.id, pointsAwarded: awardedPoints, status, availableAt };
  });
}

const externalAwardDeps = {
  withTransaction,
  setCurrentTenant,
  BusinessRepo,
  CustomerRepo,
  computePoints,
  computePointsWithEvidence,
  claimTargetedOffer,
  protectedEarningBusiness,
  getPlanFeatureOverrides: () => PlanConfigService.getPlanFeatureOverrides(),
  timingSafeEqualString
};

/**
 * @param {ExternalAwardInput} args
 */
export async function awardFromExternalEvent(args) {
  return awardFromExternalEventWithDeps(externalAwardDeps, { ...args, skipApiKeyCheck: false });
}

/**
 * @param {ExternalAwardInput} args
 */
export async function awardFromExternalEventTrusted(args) {
  return awardFromExternalEventWithDeps(externalAwardDeps, { ...args, skipApiKeyCheck: true });
}
