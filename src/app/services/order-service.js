import crypto from "node:crypto";
import { purchaseEventTime } from "./purchase-event-time.js";

import { setCurrentTenant, withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { ContactIdentifierRepo } from "../repositories/contact-identifier-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { OrderRepo } from "../repositories/order-repository.js";
import { resolveCustomerForIntegrationWithDeps } from "./customer-resolution-service.js";
import { PlanConfigService } from "./plan-config-service.js";
import { claimTargetedOffer } from "./targeted-offer-service.js";
import { isLedgerInteger } from "../../utils/ledger-limits.js";
import { computePoints } from "./points-service.js";
import { cashbackTerms } from "./cashback-model.js";
import { accrueCashback } from "./cashback-service.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";

const PROCESSABLE_STATUSES = new Set(["paid", "completed"]);

/**
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number | null }> }} OrderQueryClient
 *
 * Business row as BusinessRepo.getById returns it (repositories owner); only what this flow reads.
 * @typedef {{ id: string, plan?: string | null, program_type?: string | null, program_json?: Record<string, any> | null }} OrderBusiness
 * @typedef {{ id: string, business_id?: string }} OrderCustomer
 *
 * orders row (OrderRepo, repositories owner).
 * @typedef {{
 *   id: string,
 *   customer_id: string,
 *   transaction_id: string | null,
 *   points_awarded: number | string | null,
 *   transaction_status: string,
 *   fingerprint: string | null,
 *   [column: string]: unknown
 * }} OrderRow
 *
 * Integration body accepted by the orders endpoint; validated field by field here.
 * Line items and metadata are the integrator's own JSON documents.
 * @typedef {{
 *   businessSlug?: unknown,
 *   externalOrderId?: unknown,
 *   status?: unknown,
 *   customerId?: string | null,
 *   identifierType?: string | null,
 *   identifierValue?: string | null,
 *   customerPhone?: string | null,
 *   amount_q?: number | string | null,
 *   subtotal_q?: number | string | null,
 *   discount_q?: number | string | null,
 *   tax_q?: number | string | null,
 *   currency?: string | null,
 *   occurred_at?: unknown,
 *   source?: string | null,
 *   line_items_json?: unknown,
 *   meta?: unknown
 * }} OrderInput
 *
 * Canonical payload hashed into the order fingerprint.
 * @typedef {{
 *   customerId: string,
 *   externalOrderId: string,
 *   status: string,
 *   amount_q: number,
 *   subtotal_q: number | null,
 *   discount_q: number | null,
 *   tax_q: number | null,
 *   currency: string,
 *   occurred_at: unknown,
 *   line_items_json: any[],
 *   meta: Record<string, any>
 * }} OrderFingerprintPayload
 *
 * Row inserted through OrderRepo.create.
 * @typedef {{
 *   business_id: string,
 *   customer_id: string,
 *   external_order_id: string,
 *   status: string,
 *   amount_q: number,
 *   subtotal_q: number | null,
 *   discount_q: number | null,
 *   tax_q: number | null,
 *   currency: string,
 *   occurred_at: unknown,
 *   source: string,
 *   line_items_json: any[],
 *   meta: Record<string, any>,
 *   fingerprint: string,
 *   transaction_id: string,
 *   points_awarded: number,
 *   transaction_status: string
 * }} OrderCreateInput
 *
 * The targeted-offer claim this flow issues (targeted-offer-service.js owns the rules).
 * @typedef {{
 *   client: OrderQueryClient,
 *   business: OrderBusiness,
 *   customerId: string,
 *   transactionId: string,
 *   source: string,
 *   amountQ: number,
 *   basePoints: number,
 *   planFeatureOverrides?: Record<string, any>
 * }} OrderTargetedOfferClaim
 *
 * Order storage as this flow uses it. `create` is optional because replay-only
 * unit tests omit it; the create path asserts its presence.
 * @typedef {{
 *   findByBusinessAndExternalId: (client: OrderQueryClient, businessId: string, externalOrderId: string) => Promise<OrderRow | null | undefined>,
 *   create?: (client: OrderQueryClient, input: OrderCreateInput) => Promise<{ id: string, [column: string]: unknown }>
 * }} OrderServiceRepo
 *
 * Collaborators once defaults are applied. Members are typed by what this module uses;
 * BusinessRepo/CustomerRepo/ContactIdentifierRepo shapes belong to the repositories owner.
 * @typedef {{
 *   planFeatureOverrides: Record<string, any> | undefined,
 *   BusinessRepo: {
 *     getPublicBySlug: (slug: string) => Promise<{ id: string } | null | undefined>,
 *     getById: (id: string) => Promise<OrderBusiness | null | undefined>
 *   },
 *   ContactIdentifierRepo: Pick<typeof ContactIdentifierRepo, "getByBusinessTypeAndValue">,
 *   CustomerRepo: {
 *     getByBusinessAndId?: (businessId: string, customerId: string) => Promise<OrderCustomer | null | undefined>,
 *     getById?: (id: string) => Promise<OrderCustomer | null | undefined>,
 *     getByBusinessAndPhone?: (businessId: string, phone: string) => Promise<OrderCustomer | null | undefined>
 *   },
 *   OrderRepo: OrderServiceRepo,
 *   computePoints: (business: OrderBusiness, input: { amount_q: number }) => number,
 *   claimTargetedOffer: ((claim: OrderTargetedOfferClaim) => Promise<{ bonusPoints: number }>) | undefined,
 *   hashPayload: (payload: OrderFingerprintPayload) => string,
 *   withTransaction: <T>(fn: (client: OrderQueryClient) => Promise<T>) => Promise<T>,
 *   setCurrentTenant: (tenantId: string) => Promise<void>
 * }} OrderResolvedDeps
 *
 * What callers may inject; only `withTransaction` is mandatory.
 * @typedef {Partial<Omit<OrderResolvedDeps, "planFeatureOverrides" | "withTransaction">> & {
 *   withTransaction: OrderResolvedDeps["withTransaction"],
 *   getPlanFeatureOverrides?: () => Promise<Record<string, any>>
 * }} OrderServiceDeps
 */

function id() {
  return crypto.randomUUID();
}

/** @param {OrderFingerprintPayload} payload */
function defaultHashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

/** @param {unknown} value */
function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/** @param {unknown} value */
function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Recursively canonicalizes key order in the integrator's JSON (line items and
 * metadata) so equivalent payloads hash alike; the document keeps its own shape.
 * @param {unknown} value
 * @returns {any}
 */
function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (!isPlainObject(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = normalizeValue(value[key]);
      return acc;
    }, /** @type {Record<string, any>} */ ({}));
}

/** @param {unknown} lineItemsJson */
function normalizeLineItems(lineItemsJson) {
  const normalizedItems = Array.isArray(lineItemsJson)
    ? lineItemsJson.map((item) => normalizeValue(item))
    : [];
  return normalizedItems
    .map((item, index) => ({
      item,
      sortKey: JSON.stringify(item),
      index,
    }))
    .sort((left, right) => {
      if (left.sortKey < right.sortKey) return -1;
      if (left.sortKey > right.sortKey) return 1;
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

/**
 * @param {unknown} meta
 * @returns {Record<string, any>}
 */
function normalizeMeta(meta) {
  return normalizeValue(meta && typeof meta === "object" ? meta : {});
}

/**
 * @param {{
 *   customerId: unknown,
 *   externalOrderId: string,
 *   status: string,
 *   amount_q: unknown,
 *   subtotal_q: unknown,
 *   discount_q: unknown,
 *   tax_q: unknown,
 *   currency: unknown,
 *   occurred_at: unknown,
 *   line_items_json: unknown,
 *   meta: unknown
 * }} fields
 * @returns {OrderFingerprintPayload}
 */
function buildFingerprintPayload({
  customerId,
  externalOrderId,
  status,
  amount_q,
  subtotal_q,
  discount_q,
  tax_q,
  currency,
  occurred_at,
  line_items_json,
  meta,
}) {
  return {
    customerId: String(customerId || ""),
    externalOrderId: String(externalOrderId || ""),
    status: String(status || ""),
    amount_q: Number(amount_q || 0),
    subtotal_q: subtotal_q === null ? null : Number(subtotal_q || 0),
    discount_q: discount_q === null ? null : Number(discount_q || 0),
    tax_q: tax_q === null ? null : Number(tax_q || 0),
    currency: String(currency || "GTQ").toUpperCase(),
    occurred_at: occurred_at ?? null,
    line_items_json: Array.isArray(line_items_json) ? line_items_json : [],
    meta: meta && typeof meta === "object" ? meta : {},
  };
}

/**
 * @param {OrderResolvedDeps} deps
 * @param {OrderQueryClient} client
 * @param {string} businessId
 * @param {string} externalOrderId
 */
async function findExistingOrder(deps, client, businessId, externalOrderId) {
  return deps.OrderRepo.findByBusinessAndExternalId(client, businessId, externalOrderId);
}

/**
 * @param {OrderResolvedDeps} deps
 * @param {OrderQueryClient} client
 * @param {OrderCreateInput} input
 */
async function createOrder(deps, client, input) {
  return /** @type {Required<OrderServiceRepo>} */ (deps.OrderRepo).create(client, input);
}

/**
 * @param {OrderQueryClient} client
 * @param {string} businessId
 * @param {string} externalOrderId
 */
async function lockOrderRequest(client, businessId, externalOrderId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
    String(businessId),
    String(externalOrderId),
  ]);
}

/**
 * @param {OrderResolvedDeps} deps
 * @param {OrderQueryClient} client
 * @param {OrderInput} input
 */
async function processOrderWithClient(deps, client, input) {
  const externalOrderId = String(input.externalOrderId || "").trim();
  if (!externalOrderId) throw badRequest("externalOrderId required");

  const status = normalizeStatus(input.status);
  if (!PROCESSABLE_STATUSES.has(status)) throw badRequest("Unsupported order status");
  const purchaseTime = purchaseEventTime(input.occurred_at, "order_receipt");

  const lineItemsJson = normalizeLineItems(input.line_items_json);
  const meta = normalizeMeta(input.meta);

  const publicBusiness = await deps.BusinessRepo.getPublicBySlug(String(input.businessSlug || ""));
  if (!publicBusiness) throw notFound("Business not found");

  await deps.setCurrentTenant(String(publicBusiness.id));
  const business = await deps.BusinessRepo.getById(String(publicBusiness.id));
  if (!business) throw notFound("Business not found");

  await lockOrderRequest(client, business.id, externalOrderId);
  const existing = await findExistingOrder(deps, client, business.id, externalOrderId);
  const holdDays = Math.max(
    0,
    Math.floor(Number(business.program_json?.pending_points_hold_days ?? 0)),
  );
  const transactionStatus = holdDays > 0 ? "PENDING" : "POSTED";
  const availableAt = holdDays > 0 ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000) : null;

  if (existing && input.customerId && String(existing.customer_id) === String(input.customerId)) {
    const earlyPayload = buildFingerprintPayload({
      customerId: input.customerId,
      externalOrderId,
      status,
      amount_q: input.amount_q,
      subtotal_q: input.subtotal_q,
      discount_q: input.discount_q,
      tax_q: input.tax_q,
      currency: input.currency,
      occurred_at: input.occurred_at,
      line_items_json: lineItemsJson,
      meta,
    });
    const earlyFingerprint = deps.hashPayload(earlyPayload);
    if (String(existing.fingerprint || "") !== String(earlyFingerprint || "")) {
      throw conflict("externalOrderId already used for a different payload");
    }
    return {
      ok: true,
      orderId: existing.id,
      transactionId: existing.transaction_id,
      customerId: existing.customer_id,
      pointsAwarded: Number(existing.points_awarded || 0),
      status: existing.transaction_status,
      replay: true,
    };
  }

  const resolutionDeps = {
    ...deps,
    client,
  };

  const customer = await resolveCustomerForIntegrationWithDeps(resolutionDeps, {
    businessId: business.id,
    customerId: input.customerId,
    identifierType: input.identifierType,
    identifierValue: input.identifierValue,
    customerPhone: input.customerPhone,
  });

  const payload = buildFingerprintPayload({
    customerId: customer.id,
    externalOrderId,
    status,
    amount_q: input.amount_q,
    subtotal_q: input.subtotal_q,
    discount_q: input.discount_q,
    tax_q: input.tax_q,
    currency: input.currency,
    occurred_at: input.occurred_at,
    line_items_json: lineItemsJson,
    meta,
  });
  const fingerprint = deps.hashPayload(payload);

  if (existing) {
    if (
      String(existing.customer_id) !== String(customer.id) ||
      String(existing.fingerprint || "") !== String(fingerprint || "")
    ) {
      throw conflict("externalOrderId already used for a different payload");
    }
    return {
      ok: true,
      orderId: existing.id,
      transactionId: existing.transaction_id,
      customerId: existing.customer_id,
      pointsAwarded: Number(existing.points_awarded || 0),
      status: existing.transaction_status,
      replay: true,
    };
  }

  const amountQ = Number(input.amount_q || 0);
  const subtotalQ = normalizeNumber(input.subtotal_q);
  const discountQ = normalizeNumber(input.discount_q);
  const taxQ = normalizeNumber(input.tax_q);
  const currency = String(input.currency || "GTQ").toUpperCase();
  const basePoints = Number(deps.computePoints(business, { amount_q: amountQ }) || 0);
  const transactionId = id();
  const bonus =
    typeof deps.claimTargetedOffer === "function"
      ? await deps.claimTargetedOffer({
          client,
          business,
          customerId: customer.id,
          transactionId,
          source: "order",
          amountQ,
          basePoints,
          planFeatureOverrides: deps.planFeatureOverrides,
        })
      : { bonusPoints: 0 };
  const pointsAwarded = basePoints + bonus.bonusPoints;
  if (!isLedgerInteger(pointsAwarded))
    throw badRequest("Computed points must be a non-negative ledger integer");

  await client.query(
    `INSERT INTO transactions
     (id, business_id, customer_id, amount_q, points, status, available_at, source, meta, purchase_occurred_at, purchase_time_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'order',$8,$9,$10)`,
    [
      transactionId,
      business.id,
      customer.id,
      amountQ,
      pointsAwarded,
      transactionStatus,
      availableAt,
      {
        external_order_id: externalOrderId,
        order_fingerprint: fingerprint,
      },
      purchaseTime.occurredAt,
      purchaseTime.source,
    ],
  );

  await client.query(
    `UPDATE customer_balances
     SET points = points + CASE WHEN $3 = 'POSTED' THEN $2 ELSE 0 END,
         pending_points = pending_points + CASE WHEN $3 = 'PENDING' THEN $2 ELSE 0 END,
         lifetime_points = lifetime_points + CASE WHEN $3 = 'POSTED' THEN GREATEST($2, 0) ELSE 0 END,
         updated_at = now()
     WHERE customer_id = $1`,
    [customer.id, pointsAwarded, transactionStatus],
  );

  if (business.program_type === "CASHBACK" && transactionStatus === "POSTED") {
    const cashback = cashbackTerms(business, { amount_q: amountQ });
    if (cashback && cashback.earn_q > 0) {
      await accrueCashback(client, {
        businessId: business.id,
        customerId: customer.id,
        amountQ,
        earnQ: cashback.earn_q,
        sourceTransactionId: transactionId,
        requestId: transactionId,
        meta: { percent: cashback.percent, source: "order" },
      });
    }
  }

  const order = await createOrder(deps, client, {
    business_id: business.id,
    customer_id: customer.id,
    external_order_id: externalOrderId,
    status,
    amount_q: amountQ,
    subtotal_q: subtotalQ,
    discount_q: discountQ,
    tax_q: taxQ,
    currency,
    occurred_at: input.occurred_at ?? null,
    source: input.source ?? "api",
    line_items_json: lineItemsJson,
    meta,
    fingerprint,
    transaction_id: transactionId,
    points_awarded: pointsAwarded,
    transaction_status: transactionStatus,
  });

  return {
    ok: true,
    orderId: order.id,
    transactionId,
    customerId: customer.id,
    pointsAwarded,
    status: transactionStatus,
  };
}

/**
 * @param {OrderServiceDeps} deps
 * @param {OrderInput} input
 */
export async function processOrderWithDeps(deps, input) {
  if (!deps || typeof deps.withTransaction !== "function") {
    throw badRequest("withTransaction dependency required");
  }
  const planFeatureOverrides =
    typeof deps.getPlanFeatureOverrides === "function" &&
    typeof deps.claimTargetedOffer === "function"
      ? await deps.getPlanFeatureOverrides()
      : undefined;
  /** @type {OrderResolvedDeps} */
  const resolvedDeps = {
    planFeatureOverrides,
    BusinessRepo: deps.BusinessRepo ?? BusinessRepo,
    ContactIdentifierRepo: deps.ContactIdentifierRepo ?? ContactIdentifierRepo,
    CustomerRepo: deps.CustomerRepo ?? CustomerRepo,
    OrderRepo: deps.OrderRepo ?? OrderRepo,
    computePoints: deps.computePoints ?? computePoints,
    claimTargetedOffer: deps.claimTargetedOffer,
    hashPayload: deps.hashPayload ?? defaultHashPayload,
    withTransaction: deps.withTransaction,
    setCurrentTenant: deps.setCurrentTenant ?? setCurrentTenant,
  };

  return resolvedDeps.withTransaction((client) =>
    processOrderWithClient(resolvedDeps, client, input),
  );
}

/** @param {OrderInput} input */
export async function processOrder(input) {
  return processOrderWithDeps(
    {
      withTransaction,
      BusinessRepo,
      CustomerRepo,
      OrderRepo,
      computePoints,
      claimTargetedOffer,
      getPlanFeatureOverrides: () => PlanConfigService.getPlanFeatureOverrides(),
      hashPayload: defaultHashPayload,
      setCurrentTenant,
    },
    input,
  );
}
