// Subscription orchestration for the self-serve trial, wave 2 (design of record
// docs/product/2026-11-25-self-serve-trial.md, sections 4.4 to 4.6, 5 and 6). Provider
// agnostic: providers are pure HTTP mappers (recurrente-provider.js, manual-provider.js);
// this module owns the checkout, the webhook state machine, the branch-count hooks, the
// daily reconcile and the owner/super views.
//
// Owner decisions encoded here (2026-11-25, currency and tax revised 2026-11-26):
// - Prices are the published list amounts of `billing_catalog` (src/utils/plan.js defaults
//   unless the platform setting overrides them): Q300 / Q630 / Q1,030 per branch per month
//   for Guatemalan businesses, USD 39 / 79 / 129 for businesses outside Guatemala. Both
//   include IVA (12%); nothing here computes tax.
// - Currency per customer (see businessPaysInGtq / defaultCurrency): a business counts as
//   Guatemalan when it already pays in GTQ (`billing_currency`), when its regional settings
//   resolve to the America/Guatemala timezone (the default region when none is set), or
//   when its verified trial phone carries the +502 dial code. Such a business checks out in
//   GTQ by default when GTQ is ready (catalog amounts AND Recurrente GTQ price ids for every
//   plan); otherwise, and for every other business, the default is USD. The owner may still
//   choose the currency explicitly; an explicit GTQ request while GTQ is not ready answers
//   400 BILLING_CURRENCY_UNAVAILABLE. USD runs through Recurrente today, Stripe later.
// - No FEL invoice is issued (owner decision 2026-11-26); the app still stores any `tax_invoice_url` the payment
//   webhook carries and shows it to the owner.
// - No annual plans; one monthly subscription per business.
// - Proration (section 6): upgrades and added branches apply now and charge the prorated
//   remainder (`now_and_charge`); downgrades and removed branches apply at the next cycle
//   (`next_cycle`). The entitlement (`businesses.plan`) follows the provider's current
//   item, so a pending downgrade keeps the paid plan until the cycle turns.
// - Quantity is the branch count clamped to 1..9; a tenth branch answers 409
//   BILLING_QUANTITY_LIMIT at checkout and is recorded as `subscription.sync_failed`
//   when it happens on an active subscription (never blocking the branch change).
// - Without a configured provider key every checkout route answers 503
//   BILLING_UNAVAILABLE and the owner app keeps the contact path; the wave-1 manual
//   activation (provider 'manual') stays valid and is the local source of truth.
import crypto from "node:crypto";
import { config } from "../../../config/index.js";
import { withDbClientContext, withTransaction } from "../../database.js";
import { BillingSubscriptionRepo } from "../../repositories/billing-subscription-repository.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { BillingCatalogService } from "../billing-catalog-service.js";
import { emitBillingEvent } from "../billing-service.js";
import { PLAN_DISPLAY_NAMES } from "../public-plan-service.js";
import { REGIONAL_COUNTRIES, regionTimezone } from "../regional-settings.js";
import { planDisplayName } from "../trial-entitlement.js";
import { countTrialTransition } from "../trial-metrics.js";
import { trialState } from "../trial-state.js";
import { errorMessage } from "../../../utils/error-shape.js";
import { badRequest, conflict, HttpError, notFound } from "../../../utils/http-error.js";
import { logger } from "../../../utils/logger.js";
import { isPlanName, normalizePlan, planLimits } from "../../../utils/plan.js";
import { countBillingEvent } from "./billing-metrics.js";
import { createManualProvider } from "./manual-provider.js";
import { MAX_QUANTITY, MIN_QUANTITY } from "./provider.js";
import { createRecurrenteProvider, headerValue } from "./recurrente-provider.js";

/** @typedef {import("./provider.js").BillingProvider} BillingProvider */
/** @typedef {import("./provider.js").BillingEvent} BillingEvent */
/** @typedef {import("./provider.js").SubscriptionSnapshot} SubscriptionSnapshot */
/** @typedef {import("./recurrente-provider.js").RecurrenteProvider} OnlineProvider */
/** @typedef {import("../../repositories/business-repository.js").BusinessRow} BusinessRow */
/** @typedef {import("../../repositories/trial-repository.js").BillingSubscriptionRow} BillingSubscriptionRow */
/** @typedef {import("../../repositories/billing-subscription-repository.js").BillingCheckoutRow} BillingCheckoutRow */
/** @typedef {import("../../../utils/plan.js").PlanName} PlanName */
/** @typedef {ReturnType<typeof import("../../../utils/plan.js").resolveBillingCatalog>} ResolvedCatalog */
/** @typedef {"GTQ" | "USD"} Currency */
/**
 * Collaborators; unit tests inject fakes.
 * @typedef {{
 *   repo: typeof BillingSubscriptionRepo,
 *   getBusiness: (id: string) => Promise<BusinessRow | null>,
 *   countBranches: (businessId: string) => Promise<number>,
 *   getCatalog: () => Promise<ResolvedCatalog>,
 *   setCatalog: (catalog: ResolvedCatalog) => Promise<ResolvedCatalog>,
 *   provider: OnlineProvider | null,
 *   manualProvider: BillingProvider,
 *   platform: <T>(fn: () => Promise<T>) => Promise<T>,
 *   tenant: <T>(businessId: string, fn: () => Promise<T>) => Promise<T>,
 *   transaction: <T>(fn: () => Promise<T>) => Promise<T>,
 *   emitBillingEvent: typeof emitBillingEvent,
 *   countEvent: typeof countBillingEvent,
 *   countTransition: typeof countTrialTransition,
 *   config: Pick<import("../../../types/config.js").AppConfig,
 *     "APP_ORIGIN" | "BILLING_RETURN_ORIGIN" | "BILLING_PROVIDER" | "TRIAL_RETENTION_DAYS">,
 *   now: () => Date,
 *   uuid: () => string,
 *   log: { warn: (ctx: object, msg: string) => void, info: (ctx: object, msg: string) => void }
 * }} SubscriptionServiceDeps
 */
/** @typedef {{ id: string, url: string, expires_at: string | null, plan: string, quantity: number, currency: string, unit_amount_minor: number, status: string }} CheckoutView */
/**
 * @typedef {{
 *   id: string, provider: string, plan: string, plan_name: string, quantity: number, currency: string,
 *   unit_amount_minor: number, monthly_total_minor: number, status: string,
 *   current_period_start: string | null, current_period_end: string | null, cancel_at: string | null,
 *   canceled_at: string | null, past_due_since: string | null, next_payment_attempt_at: string | null,
 *   latest_tax_invoice_url: string | null, pending_plan: string | null, pending_quantity: number | null
 * }} SubscriptionView
 */
/** @typedef {{ handled: boolean, note?: string, businessId?: string | null, subscriptionId?: string | null }} ApplyOutcome */

const DAY_MS = 86_400_000;
/** Full access continues this long after the first failed renewal charge (section 4.6). */
export const PAST_DUE_GRACE_DAYS = 7;
/** @type {readonly PlanName[]} */
const PLAN_NAMES = Object.freeze(["EMPRENDEDOR", "NEGOCIO", "EMPRESA"]);
/** @type {Record<PlanName, number>} */
const PLAN_RANK = { EMPRENDEDOR: 1, NEGOCIO: 2, EMPRESA: 3 };

const unavailable = () =>
  new HttpError(
    503,
    "El pago en línea no está disponible por ahora. Escríbenos y activamos tu plan.",
    "BILLING_UNAVAILABLE",
  );

/** @param {Date | string | null | undefined} value */
const iso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** @param {unknown} value */
const metaString = (value) =>
  typeof value === "string" && value ? value : typeof value === "number" ? String(value) : null;
/** @param {unknown} metadata @returns {Record<string, unknown>} */
const meta = (metadata) => (isRecord(metadata) ? metadata : {});

/**
 * @param {string} secretKey
 * @param {string} webhookSecret
 */
function onlineProvider(secretKey, webhookSecret) {
  if (config.BILLING_PROVIDER !== "recurrente" || !secretKey) return null;
  return createRecurrenteProvider({
    fetch: (url, init) => globalThis.fetch(url, init),
    config: {
      secretKey,
      webhookSecret,
      apiBase: config.RECURRENTE_API_BASE,
      getCatalog: () => BillingCatalogService.get(),
    },
  });
}

/** @returns {SubscriptionServiceDeps} */
function defaultDeps() {
  return {
    repo: BillingSubscriptionRepo,
    getBusiness: (id) => BusinessRepo.getById(id),
    countBranches: (id) => BusinessRepo.countBranches(id),
    getCatalog: () => BillingCatalogService.get(),
    setCatalog: (catalog) => BillingCatalogService.set(catalog),
    provider: onlineProvider(config.RECURRENTE_SECRET_KEY, config.RECURRENTE_WEBHOOK_SECRET),
    manualProvider: createManualProvider({
      getSubscription: (id) => BillingSubscriptionRepo.getSubscriptionByProviderId("manual", id),
    }),
    platform: (fn) => withDbClientContext({ platformAdmin: true, tenantId: null }, fn),
    tenant: (businessId, fn) =>
      withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn),
    transaction: (fn) => withTransaction(() => fn()),
    emitBillingEvent,
    countEvent: countBillingEvent,
    countTransition: countTrialTransition,
    config,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
    log: logger,
  };
}

/**
 * Quantity for a branch count (section 6): at least one unit, at most nine.
 * @param {number} branches
 * @returns {{ ok: true, quantity: number } | { ok: false, quantity: number }}
 */
export function quantityForBranches(branches) {
  const count = Math.max(MIN_QUANTITY, Math.trunc(Number(branches) || 0));
  return count > MAX_QUANTITY ? { ok: false, quantity: count } : { ok: true, quantity: count };
}

/**
 * Proration mode for a change (section 6): more units or a higher plan charge now,
 * fewer units or a lower plan wait for the next cycle.
 * @param {{ fromPlan: string, toPlan: string, fromQuantity: number, toQuantity: number }} change
 * @returns {"now_and_charge" | "next_cycle"}
 */
export function prorationMode({ fromPlan, toPlan, fromQuantity, toQuantity }) {
  const from = normalizePlan(fromPlan);
  const to = normalizePlan(toPlan);
  const fromRank = isPlanName(from) ? PLAN_RANK[from] : 0;
  const toRank = isPlanName(to) ? PLAN_RANK[to] : 0;
  if (toRank > fromRank) return "now_and_charge";
  if (toRank < fromRank) return "next_cycle";
  return toQuantity > fromQuantity ? "now_and_charge" : "next_cycle";
}

/**
 * Catalog readiness per currency: amounts and Recurrente price ids for every plan.
 * @param {ResolvedCatalog} catalog
 */
export function catalogReadiness(catalog) {
  const priceIds = catalog.providers.recurrente.price_ids;
  const usd = PLAN_NAMES.every((plan) => Boolean(priceIds.USD[plan]) && catalog.usd[plan] > 0);
  const gtq =
    Boolean(catalog.gtq) &&
    PLAN_NAMES.every((plan) => Boolean(priceIds.GTQ[plan]) && Number(catalog.gtq?.[plan]) > 0);
  return { usd, gtq };
}

/**
 * Whether the business is Guatemalan for billing purposes (header rule): it already pays
 * in quetzales, its regional settings resolve to Guatemala's timezone (the default region
 * when none was chosen), or its verified trial phone carries the 502 dial code
 * (`trial_phone` is stored as digits, country code first).
 * @param {Pick<BusinessRow, "billing_currency" | "program_json" | "trial_phone">} business
 */
export function businessPaysInGtq(business) {
  if (business.billing_currency === "GTQ") return true;
  if (regionTimezone(business) === REGIONAL_COUNTRIES.GT.timezone) return true;
  return String(business.trial_phone ?? "").startsWith(REGIONAL_COUNTRIES.GT.dialCode);
}

/**
 * Default checkout and catalog currency when the owner has not chosen one: GTQ for a
 * Guatemalan business while GTQ is ready, USD otherwise. An active subscription keeps its
 * own currency so plan changes are quoted in what the business already pays.
 * @param {{ business: Pick<BusinessRow, "billing_currency" | "program_json" | "trial_phone">, catalog: ResolvedCatalog, active?: { currency: string } | null }} input
 * @returns {Currency}
 */
export function defaultCurrency({ business, catalog, active = null }) {
  if (active) return active.currency === "GTQ" ? "GTQ" : "USD";
  return businessPaysInGtq(business) && catalogReadiness(catalog).gtq ? "GTQ" : "USD";
}

/**
 * @param {ResolvedCatalog} catalog
 * @param {Currency} currency
 */
export function catalogPlans(catalog, currency) {
  const amounts = currency === "GTQ" && catalog.gtq ? catalog.gtq : catalog.usd;
  return PLAN_NAMES.map((plan) => ({
    id: plan,
    name: PLAN_DISPLAY_NAMES[plan],
    unit_amount_minor: Math.round(Number(amounts[plan]) * 100),
    monthly: Number(amounts[plan]),
  }));
}

/** @param {BillingCheckoutRow} row @returns {CheckoutView} */
export function checkoutView(row) {
  return {
    id: row.id,
    url: row.checkout_url,
    expires_at: iso(row.expires_at),
    plan: row.plan,
    quantity: Number(row.quantity),
    currency: row.currency,
    unit_amount_minor: Number(row.unit_amount_minor),
    status: row.status,
  };
}

/** @param {BillingSubscriptionRow} row @returns {SubscriptionView} */
export function subscriptionView(row) {
  const m = meta(row.metadata);
  const quantity = Number(row.quantity);
  const unit = Number(row.unit_amount_minor);
  return {
    id: row.id,
    provider: row.provider,
    plan: row.plan,
    plan_name: planDisplayName(row.plan),
    quantity,
    currency: row.currency,
    unit_amount_minor: unit,
    monthly_total_minor: unit * quantity,
    status: row.status,
    current_period_start: iso(row.current_period_start),
    current_period_end: iso(row.current_period_end),
    cancel_at: iso(row.cancel_at),
    canceled_at: iso(row.canceled_at),
    past_due_since: iso(metaString(m.past_due_since)),
    next_payment_attempt_at: iso(metaString(m.provider_next_payment_attempt_at)),
    latest_tax_invoice_url: metaString(m.latest_tax_invoice_url),
    pending_plan: metaString(m.pending_plan),
    pending_quantity: m.pending_quantity == null ? null : Number(m.pending_quantity) || null,
  };
}

/**
 * The webhook outcome a route turns into an HTTP response.
 * @typedef {{ status: number, body: Record<string, unknown> }} WebhookResult
 */

/**
 * @param {Partial<SubscriptionServiceDeps>} [overrides]
 */
export function createSubscriptionService(overrides = {}) {
  /** @type {SubscriptionServiceDeps} */
  const deps = { ...defaultDeps(), ...overrides };
  const providerName = deps.provider?.name ?? deps.config.BILLING_PROVIDER;

  const isConfigured = () => Boolean(deps.provider);

  function requireProvider() {
    if (!deps.provider) throw unavailable();
    return deps.provider;
  }

  /** @param {string} name */
  function providerFor(name) {
    if (name === "manual") return deps.manualProvider;
    return deps.provider && deps.provider.name === name ? deps.provider : null;
  }

  /** @param {Date} now */
  const retentionDate = (now) =>
    new Date(now.getTime() + deps.config.TRIAL_RETENTION_DAYS * DAY_MS);

  /**
   * Branch count under the business's tenant context: `branches` is a tenant table, so a
   * caller outside a request (branch hook from a job, the integration harness) would
   * otherwise count zero under RLS.
   * @param {string} businessId
   */
  const countBranches = (businessId) =>
    deps.tenant(businessId, () => deps.countBranches(businessId));

  /** @param {string} plan */
  function requirePlan(plan) {
    const key = normalizePlan(plan);
    if (!isPlanName(key)) throw badRequest("Plan inválido", "BILLING_PLAN_INVALID");
    return key;
  }

  /**
   * @param {string} businessId
   * @param {string} eventType
   * @param {Record<string, unknown>} [metadata]
   */
  async function record(businessId, eventType, metadata = {}) {
    await deps.tenant(businessId, () => deps.emitBillingEvent({ businessId, eventType, metadata }));
    deps.countEvent(eventType);
  }

  /**
   * Currency for a checkout: the owner's explicit request, else the header rule
   * (defaultCurrency: GTQ for a Guatemalan business when GTQ is ready, USD otherwise).
   * @param {{ requested: string | null | undefined, business: BusinessRow, catalog: ResolvedCatalog }} input
   * @returns {Currency}
   */
  function resolveCurrency({ requested, business, catalog }) {
    const ready = catalogReadiness(catalog);
    if (requested === "GTQ") {
      if (!ready.gtq)
        throw badRequest(
          "El cobro en quetzales aún no está disponible; el plan se cobra en USD.",
          "BILLING_CURRENCY_UNAVAILABLE",
        );
      return "GTQ";
    }
    if (requested && requested !== "USD")
      throw badRequest("Moneda inválida", "BILLING_CURRENCY_UNAVAILABLE");
    if (!requested && defaultCurrency({ business, catalog }) === "GTQ") return "GTQ";
    if (!ready.usd) throw unavailable();
    return "USD";
  }

  /**
   * Copies the provider snapshot into a subscription patch; `provider_*` extras and our
   * own bookkeeping live side by side in metadata.
   * @param {BillingSubscriptionRow} row
   * @param {SubscriptionSnapshot} snapshot
   * @param {Record<string, unknown>} [extra]
   */
  function patchFromSnapshot(row, snapshot, extra = {}) {
    const previous = meta(row.metadata);
    /** @type {Record<string, unknown>} */
    const metadata = { ...previous, ...extra };
    for (const [key, value] of Object.entries(snapshot.metadata)) {
      if (key.startsWith("provider_")) metadata[key] = value;
    }
    return {
      status: snapshot.status,
      current_period_start: snapshot.currentPeriodStart,
      current_period_end: snapshot.currentPeriodEnd,
      cancel_at: snapshot.cancelAt,
      metadata,
    };
  }

  // ---------------------------------------------------------------------------------
  // Owner views

  /** @param {string} businessId */
  async function overview(businessId) {
    const now = deps.now();
    const business = await deps.getBusiness(businessId);
    if (!business) throw notFound("Negocio no encontrado");
    const [active, branches, catalog, pending] = await Promise.all([
      deps.repo.activeSubscription(businessId),
      countBranches(businessId),
      deps.getCatalog(),
      deps.repo.findOpenCheckout({ businessId, now }),
    ]);
    /** @type {BillingSubscriptionRow | null} */
    const subscription = active ?? (await deps.repo.latestSubscription(businessId));
    const ready = catalogReadiness(catalog);
    // The plan page quotes in the currency the business pays or will pay (header rule).
    const currency = defaultCurrency({ business, catalog, active });
    const catalogReady = currency === "GTQ" ? ready.gtq : ready.usd;
    const state = trialState(business, { now, timezone: regionTimezone(business) });
    const view = subscription ? subscriptionView(subscription) : null;
    const lockReason =
      business.billing_status !== "locked"
        ? null
        : business.trial_status === "expired" && !subscription
          ? "trial_expired"
          : subscription?.status === "canceled"
            ? "canceled"
            : "payment_failed";
    return {
      billing: {
        status: business.billing_status,
        provider: active?.provider ?? (isConfigured() ? providerName : null),
        currency,
        plan: business.plan,
        plan_name: planDisplayName(business.plan),
        quantity: view?.quantity ?? quantityForBranches(branches).quantity,
        unit_amount_minor:
          view?.unit_amount_minor ??
          catalogPlans(catalog, currency).find((p) => p.id === normalizePlan(business.plan))
            ?.unit_amount_minor ??
          null,
        monthly_total_minor: view?.monthly_total_minor ?? null,
        current_period_start: view?.current_period_start ?? null,
        current_period_end: view?.current_period_end ?? null,
        cancel_at: view?.cancel_at ?? null,
        past_due_since: view?.past_due_since ?? null,
        next_payment_attempt_at: view?.next_payment_attempt_at ?? null,
        latest_tax_invoice_url: view?.latest_tax_invoice_url ?? null,
        upgrade_available: isConfigured() && catalogReady && !active,
        change_available:
          isConfigured() &&
          catalogReady &&
          Boolean(active) &&
          active.provider === providerName &&
          (active.status === "active" || active.status === "past_due"),
        checkout_pending: pending
          ? { id: pending.id, url: pending.checkout_url, expires_at: iso(pending.expires_at) }
          : null,
        lock_reason: lockReason,
        subscription: view,
      },
      catalog: {
        currency,
        currencies: [...(ready.usd ? ["USD"] : []), ...(ready.gtq ? ["GTQ"] : [])],
        iva_included: catalog.iva_included,
        plans: catalogPlans(catalog, currency),
      },
      branches,
      trial: { status: state.status, days_left: state.days_left, ends_at: state.ends_at },
    };
  }

  /** @param {string} businessId */
  async function invoices(businessId) {
    const rows = await deps.repo.listPaymentEvents(businessId);
    return rows.map((row) => {
      const m = meta(row.metadata);
      return {
        occurred_at: iso(metaString(m.occurred_at)) ?? iso(row.created_at),
        amount_minor: m.amount_minor == null ? null : Number(m.amount_minor),
        currency: metaString(m.currency),
        status:
          row.event_type === "payment.succeeded"
            ? "paid"
            : row.event_type === "payment.refunded"
              ? "refunded"
              : "failed",
        tax_invoice_url: metaString(m.tax_invoice_url),
        fee_minor: m.fee_minor == null ? null : Number(m.fee_minor),
        intent_id: metaString(m.intent_id),
      };
    });
  }

  // ---------------------------------------------------------------------------------
  // Checkout

  /** @param {{ businessId: string, plan: string, currency?: string | null }} input */
  async function startCheckout({ businessId, plan, currency = null }) {
    const provider = requireProvider();
    const now = deps.now();
    const business = await deps.getBusiness(businessId);
    if (!business) throw notFound("Negocio no encontrado");
    const planKey = requirePlan(plan);
    const catalog = await deps.getCatalog();
    const chosen = resolveCurrency({ requested: currency, business, catalog });
    const active = await deps.repo.activeSubscription(businessId);
    if (active)
      throw conflict(
        "Tu negocio ya tiene un plan activo; cambia de plan en lugar de iniciar otro pago.",
        "BILLING_ALREADY_ACTIVE",
      );
    const branches = await countBranches(businessId);
    const quantity = quantityForBranches(branches);
    if (!quantity.ok)
      throw conflict(
        `El pago en línea cubre hasta ${MAX_QUANTITY} sucursales; escríbenos para un plan a medida.`,
        "BILLING_QUANTITY_LIMIT",
      );
    const pending = await deps.repo.findOpenCheckout({
      businessId,
      now,
      plan: planKey,
      currency: chosen,
      quantity: quantity.quantity,
    });
    if (pending) return { reused: true, checkout: checkoutView(pending) };

    let customer = await deps.platform(() => deps.repo.getCustomer(businessId, provider.name));
    if (!customer) {
      const ref = await provider.createCustomer({
        businessId,
        email: business.email,
        name: business.name,
        phone: business.phone ?? null,
      });
      customer = await deps.platform(() =>
        deps.repo.upsertCustomer({
          businessId,
          provider: provider.name,
          providerCustomerId: ref.providerCustomerId,
          email: business.email,
        }),
      );
    }
    const checkoutId = deps.uuid();
    const origin = String(deps.config.BILLING_RETURN_ORIGIN || deps.config.APP_ORIGIN).replace(
      /\/+$/,
      "",
    );
    const created = await provider.createCheckout({
      customer: { provider: provider.name, providerCustomerId: customer.provider_customer_id },
      plan: planKey,
      quantity: quantity.quantity,
      currency: chosen,
      successUrl: `${origin}/negocio/#plan?checkout=${checkoutId}&resultado=exito`,
      cancelUrl: `${origin}/negocio/#plan?checkout=${checkoutId}&resultado=cancelado`,
      metadata: {
        business_id: businessId,
        checkout_id: checkoutId,
        plan: planKey,
        quantity: String(quantity.quantity),
        currency: chosen,
      },
      idempotencyKey: checkoutId,
    });
    const row = await deps.platform(() =>
      deps.repo.insertCheckout({
        id: checkoutId,
        businessId,
        provider: provider.name,
        providerCheckoutId: created.providerCheckoutId,
        plan: planKey,
        quantity: quantity.quantity,
        currency: chosen,
        unitAmountMinor: created.unitAmountMinor,
        checkoutUrl: created.url,
        expiresAt: created.expiresAt,
      }),
    );
    await record(businessId, "checkout.created", {
      checkout_id: checkoutId,
      provider: provider.name,
      plan: planKey,
      quantity: quantity.quantity,
      currency: chosen,
      unit_amount_minor: created.unitAmountMinor,
    });
    return { reused: false, checkout: checkoutView(row) };
  }

  /** @param {{ businessId: string, checkoutId: string }} input */
  async function checkoutStatus({ businessId, checkoutId }) {
    const row = await deps.repo.getCheckout(checkoutId);
    if (!row || String(row.business_id) !== String(businessId))
      throw notFound("Pago no encontrado", "BILLING_CHECKOUT_NOT_FOUND");
    const now = deps.now();
    /** @type {"pending" | "completed" | "expired" | "canceled"} */
    let status;
    if (row.status === "paid") status = "completed";
    else if (row.status === "expired") status = "expired";
    else if (row.status === "abandoned") status = "canceled";
    else status = row.expires_at && new Date(row.expires_at) <= now ? "expired" : "pending";
    const subscription =
      status === "completed" ? await deps.repo.activeSubscription(businessId) : null;
    return {
      status,
      checkout: checkoutView(row),
      subscription: subscription ? subscriptionView(subscription) : null,
    };
  }

  // ---------------------------------------------------------------------------------
  // Plan changes and cancellation

  /** @param {{ businessId: string, plan: string }} input */
  async function changePlan({ businessId, plan }) {
    const planKey = requirePlan(plan);
    const sub = await deps.repo.activeSubscription(businessId);
    if (!sub) throw notFound("Tu negocio no tiene un plan activo.", "BILLING_NO_SUBSCRIPTION");
    const provider = providerFor(sub.provider);
    if (!provider || sub.provider === "manual")
      throw conflict(
        "Tu plan actual lo gestiona el equipo de PuntosFieles; escríbenos para cambiarlo.",
        "BILLING_PROVIDER_MISMATCH",
      );
    if (normalizePlan(sub.plan) === planKey) return subscriptionView(sub);
    const catalog = await deps.getCatalog();
    const ready = catalogReadiness(catalog);
    if (!(sub.currency === "GTQ" ? ready.gtq : ready.usd)) throw unavailable();
    const branches = await countBranches(businessId);
    const limits = planLimits(planKey);
    if (branches > limits.branches)
      throw conflict(
        `El plan ${PLAN_DISPLAY_NAMES[planKey]} admite ${limits.branches} ${limits.branches === 1 ? "sucursal" : "sucursales"}; tu negocio tiene ${branches}.`,
        "BILLING_PLAN_LIMITS",
      );
    const mode = prorationMode({
      fromPlan: sub.plan,
      toPlan: planKey,
      fromQuantity: Number(sub.quantity),
      toQuantity: Number(sub.quantity),
    });
    const snapshot = await provider.changeSubscription(sub.provider_subscription_id, {
      plan: planKey,
      quantity: Number(sub.quantity),
      mode,
    });
    const applied = normalizePlan(snapshot.plan) === planKey;
    const updated = await deps.platform(() =>
      deps.transaction(async () => {
        const row = await deps.repo.updateSubscription(sub.id, {
          ...patchFromSnapshot(sub, snapshot, {
            pending_plan: applied ? null : planKey,
            pending_mode: applied ? null : mode,
            unit_amount_minor_pending: applied ? null : snapshot.unitAmountMinor,
          }),
          plan: applied ? planKey : sub.plan,
          unit_amount_minor: applied ? snapshot.unitAmountMinor : Number(sub.unit_amount_minor),
        });
        if (applied) await deps.repo.setPlan({ businessId, plan: planKey });
        return row;
      }),
    );
    await record(businessId, "subscription.changed", {
      from_plan: sub.plan,
      to_plan: planKey,
      mode,
      applied,
      quantity: Number(sub.quantity),
    });
    return subscriptionView(updated ?? sub);
  }

  /**
   * Terminal cancel: the subscription row closes and the business loses access now
   * (locked with the retention clock) because nothing is paid any more.
   * @param {{ sub: BillingSubscriptionRow, snapshot: SubscriptionSnapshot | null, reason: string, now: Date }} input
   */
  async function finalizeCancel({ sub, snapshot, reason, now }) {
    /** @type {Record<string, unknown>} */
    const metadata = {
      ...meta(sub.metadata),
      cancellation_reason: reason,
      ...(snapshot ? patchFromSnapshot(sub, snapshot).metadata : {}),
    };
    const endedAt =
      iso(metaString(metadata.provider_ended_at)) ??
      snapshot?.cancelAt ??
      iso(sub.cancel_at) ??
      iso(sub.current_period_end);
    const ended = !endedAt || new Date(endedAt) <= now;
    const row = await deps.repo.updateSubscription(sub.id, {
      status: "canceled",
      canceled_at: now,
      cancel_at: endedAt ?? now,
      current_period_start: snapshot?.currentPeriodStart ?? sub.current_period_start,
      current_period_end: snapshot?.currentPeriodEnd ?? sub.current_period_end,
      metadata,
    });
    if (ended) {
      await deps.repo.lockBusiness({
        businessId: sub.business_id,
        now,
        purgeAfter: retentionDate(now),
      });
    } else {
      await deps.repo.setBillingStatus({ businessId: sub.business_id, status: "canceled" });
    }
    return { row, ended, endedAt };
  }

  /** @param {{ businessId: string, atPeriodEnd?: boolean, by?: string | null }} input */
  async function cancel({ businessId, atPeriodEnd = true, by = null }) {
    const now = deps.now();
    const sub = await deps.repo.activeSubscription(businessId);
    if (!sub) throw notFound("Tu negocio no tiene un plan activo.", "BILLING_NO_SUBSCRIPTION");
    const provider = providerFor(sub.provider);
    if (!provider) throw unavailable();
    const snapshot = await provider.cancel(sub.provider_subscription_id, {
      atPeriodEnd,
      reason: by ? `owner:${by}` : "owner",
    });
    if (atPeriodEnd && snapshot.status !== "canceled") {
      const cancelAt = snapshot.cancelAt ?? iso(sub.current_period_end);
      const updated = await deps.platform(() =>
        deps.repo.updateSubscription(sub.id, {
          ...patchFromSnapshot(sub, snapshot, { cancel_requested_at: now.toISOString() }),
          cancel_at: cancelAt,
        }),
      );
      await record(businessId, "subscription.cancel_requested", {
        cancel_at: cancelAt,
        by: by ?? null,
      });
      return subscriptionView(updated ?? sub);
    }
    const { row } = await deps.platform(() =>
      deps.transaction(() => finalizeCancel({ sub, snapshot, reason: "owner", now })),
    );
    await record(businessId, "subscription.canceled", { reason: "owner", by: by ?? null });
    return subscriptionView(row ?? sub);
  }

  /** @param {{ businessId: string, atPeriodEnd?: boolean, by?: string | null }} input */
  async function superCancel({ businessId, atPeriodEnd = false, by = null }) {
    const now = deps.now();
    const sub = await deps.platform(() => deps.repo.activeSubscription(businessId));
    if (!sub) throw notFound("El negocio no tiene un plan activo.", "BILLING_NO_SUBSCRIPTION");
    const provider = providerFor(sub.provider);
    if (!provider) throw unavailable();
    const snapshot = await provider.cancel(sub.provider_subscription_id, {
      atPeriodEnd,
      reason: `super:${by ?? "platform"}`,
    });
    if (atPeriodEnd && snapshot.status !== "canceled") {
      const cancelAt = snapshot.cancelAt ?? iso(sub.current_period_end);
      const updated = await deps.platform(() =>
        deps.repo.updateSubscription(sub.id, {
          ...patchFromSnapshot(sub, snapshot, { cancel_requested_at: now.toISOString() }),
          cancel_at: cancelAt,
        }),
      );
      await record(businessId, "subscription.cancel_requested", { cancel_at: cancelAt, by });
      return { subscription: subscriptionView(updated ?? sub), ended: false };
    }
    const { row, ended } = await deps.platform(() =>
      deps.transaction(() => finalizeCancel({ sub, snapshot, reason: "super", now })),
    );
    await record(businessId, "subscription.canceled", { reason: "super", by });
    return { subscription: subscriptionView(row ?? sub), ended };
  }

  // ---------------------------------------------------------------------------------
  // Webhook state machine

  /**
   * Creates the local subscription and activates the business from a paid checkout
   * (or, when the checkout row is gone, from the metadata the checkout carried).
   * @param {{
   *   businessId: string, checkout: BillingCheckoutRow | null, providerSubscriptionId: string,
   *   snapshot: SubscriptionSnapshot | null, event: BillingEvent, now: Date
   * }} input
   */
  async function activate({ businessId, checkout, providerSubscriptionId, snapshot, event, now }) {
    const business = await deps.getBusiness(businessId);
    if (!business) return null;
    const plan = normalizePlan(
      checkout?.plan ?? snapshot?.plan ?? event.metadata.plan ?? business.plan,
    );
    if (!isPlanName(plan)) return null;
    /** @type {Currency} */
    const currency =
      checkout?.currency === "GTQ" || snapshot?.currency === "GTQ" || event.currency === "GTQ"
        ? "GTQ"
        : "USD";
    const quantity = Math.max(
      MIN_QUANTITY,
      Number(checkout?.quantity ?? snapshot?.quantity ?? event.metadata.quantity ?? 1) || 1,
    );
    const catalog = await deps.getCatalog();
    const unitAmountMinor = Number(
      checkout?.unit_amount_minor ??
        snapshot?.unitAmountMinor ??
        catalogPlans(catalog, currency).find((p) => p.id === plan)?.unit_amount_minor ??
        0,
    );
    const expected = unitAmountMinor * quantity;
    /** @type {Record<string, unknown>} */
    const metadata = {
      checkout_id: checkout?.id ?? event.metadata.checkout_id ?? null,
      activated_at: now.toISOString(),
      activated_by_event: event.type,
      live_mode: event.liveMode,
      ...(event.amountMinor !== undefined && event.amountMinor !== expected
        ? { first_amount_mismatch: { expected, received: event.amountMinor } }
        : {}),
    };
    if (snapshot)
      for (const [key, value] of Object.entries(snapshot.metadata))
        if (key.startsWith("provider_")) metadata[key] = value;
    const wasTrial = business.trial_status !== "none";
    const row = await deps.repo.insertSubscription({
      id: deps.uuid(),
      businessId,
      provider: event.providerCustomerId && deps.provider ? deps.provider.name : providerName,
      providerSubscriptionId,
      checkoutId: checkout?.id ?? null,
      plan,
      quantity,
      currency,
      unitAmountMinor,
      status: snapshot?.status === "past_due" ? "past_due" : "active",
      currentPeriodStart: snapshot?.currentPeriodStart ?? now,
      currentPeriodEnd: snapshot?.currentPeriodEnd ?? null,
      cancelAt: snapshot?.cancelAt ?? null,
      metadata,
    });
    await deps.repo.cancelOtherOpenSubscriptions(businessId, row.id, now);
    if (checkout) await deps.repo.closeCheckout(checkout.id, "paid");
    await deps.repo.abandonOtherOpenCheckouts(businessId, checkout?.id ?? null);
    await deps.repo.activateBusiness({ businessId, plan, currency });
    if (checkout)
      await record(businessId, "checkout.completed", {
        checkout_id: checkout.id,
        provider_checkout_id: checkout.provider_checkout_id,
      });
    if (wasTrial) {
      deps.countTransition("converted");
      await record(businessId, "trial.converted", {
        plan,
        provider: row.provider,
        currency,
        quantity,
      });
    }
    await record(businessId, "subscription.activated", {
      plan,
      provider: row.provider,
      currency,
      quantity,
      unit_amount_minor: unitAmountMinor,
      provider_subscription_id: providerSubscriptionId,
    });
    return row;
  }

  /**
   * Payment outcome in the tenant ledger (the owner's invoice list reads these rows).
   * @param {{ businessId: string, event: BillingEvent, outcome: "succeeded" | "failed" | "refunded" }} input
   */
  async function recordPayment({ businessId, event, outcome }) {
    await record(businessId, `payment.${outcome}`, {
      intent_id: event.id,
      occurred_at: event.occurredAt,
      amount_minor: event.amountMinor ?? null,
      currency: event.currency ?? null,
      fee_minor: event.feeMinor ?? null,
      tax_invoice_url: event.taxInvoiceUrl ?? null,
      provider_subscription_id: event.providerSubscriptionId ?? null,
      live_mode: event.liveMode,
    });
  }

  /**
   * A failed renewal charge: the subscription is past due and the business keeps full
   * access for the grace period (section 4.6).
   * @param {{ sub: BillingSubscriptionRow, snapshot: SubscriptionSnapshot | null, event: BillingEvent, now: Date }} input
   */
  async function markPastDue({ sub, snapshot, event, now }) {
    const previous = meta(sub.metadata);
    const extra = {
      past_due_since: metaString(previous.past_due_since) ?? event.occurredAt ?? now.toISOString(),
      last_failed_payment_at: event.occurredAt,
    };
    const patch = snapshot
      ? patchFromSnapshot(sub, snapshot, extra)
      : { metadata: { ...previous, ...extra } };
    const row = await deps.repo.updateSubscription(sub.id, {
      ...patch,
      status: snapshot?.status === "canceled" ? "canceled" : "past_due",
    });
    const business = await deps.getBusiness(sub.business_id);
    if (business && business.billing_status === "active")
      await deps.repo.setBillingStatus({ businessId: sub.business_id, status: "past_due" });
    if (sub.status !== "past_due")
      await record(sub.business_id, "subscription.past_due", {
        since: extra.past_due_since,
        next_payment_attempt_at: snapshot?.metadata.provider_next_payment_attempt_at || null,
        payment_retries: snapshot?.metadata.provider_payment_retries || null,
      });
    return row;
  }

  /**
   * Successful charge on an existing subscription: a renewal, or the first payment
   * arriving after `subscription.create` already activated the business.
   * @param {{ sub: BillingSubscriptionRow, snapshot: SubscriptionSnapshot | null, event: BillingEvent, now: Date }} input
   */
  async function recordRenewal({ sub, snapshot, event, now }) {
    const previous = meta(sub.metadata);
    const firstPayment = !previous.first_payment_at;
    const extra = {
      first_payment_at: metaString(previous.first_payment_at) ?? event.occurredAt,
      last_payment_at: event.occurredAt,
      last_fee_minor: event.feeMinor ?? null,
      latest_tax_invoice_url: event.taxInvoiceUrl ?? metaString(previous.latest_tax_invoice_url),
      payment_recorded_at: now.toISOString(),
      past_due_since: null,
      last_failed_payment_at: null,
    };
    const patch = snapshot
      ? patchFromSnapshot(sub, snapshot, extra)
      : { metadata: { ...previous, ...extra } };
    const row = await deps.repo.updateSubscription(sub.id, {
      ...patch,
      status: snapshot && snapshot.status !== "active" ? snapshot.status : "active",
    });
    const business = await deps.getBusiness(sub.business_id);
    const recovered = Boolean(
      business && (business.billing_status === "past_due" || business.billing_status === "locked"),
    );
    if (recovered)
      await deps.repo.setBillingStatus({ businessId: sub.business_id, status: "active" });
    if (!firstPayment)
      await record(sub.business_id, "subscription.renewed", {
        amount_minor: event.amountMinor ?? null,
        currency: event.currency ?? null,
        fee_minor: event.feeMinor ?? null,
        tax_invoice_url: event.taxInvoiceUrl ?? null,
        current_period_end: snapshot?.currentPeriodEnd ?? iso(sub.current_period_end),
        recovered,
      });
    return row;
  }

  /**
   * Converges a local subscription on a provider snapshot (webhook `subscription.*`
   * events and the daily reconcile share it) and moves the business access state.
   * @param {{ sub: BillingSubscriptionRow, snapshot: SubscriptionSnapshot, now: Date, source: string }} input
   */
  async function converge({ sub, snapshot, now, source }) {
    if (snapshot.status === "canceled") {
      const { row } = await finalizeCancel({
        sub,
        snapshot,
        reason: snapshot.metadata.provider_cancellation_reason || source,
        now,
      });
      await record(sub.business_id, "subscription.canceled", {
        reason: snapshot.metadata.provider_cancellation_reason || null,
        source,
        cancel_at: row?.cancel_at ? iso(row.cancel_at) : null,
      });
      return row;
    }
    const previous = meta(sub.metadata);
    const planChanged = isPlanName(snapshot.plan) && normalizePlan(sub.plan) !== snapshot.plan;
    const quantityChanged = snapshot.quantity !== Number(sub.quantity);
    const pendingPlan = metaString(previous.pending_plan);
    const pendingQuantity =
      previous.pending_quantity == null ? null : Number(previous.pending_quantity);
    // The first read that reports past_due starts the grace clock (section 4.6); a read
    // that reports active clears it.
    const pastDueSince =
      snapshot.status === "past_due"
        ? (metaString(previous.past_due_since) ?? now.toISOString())
        : snapshot.status === "active"
          ? null
          : metaString(previous.past_due_since);
    const patch = patchFromSnapshot(sub, snapshot, {
      pending_plan: pendingPlan && pendingPlan === snapshot.plan ? null : pendingPlan,
      pending_quantity:
        pendingQuantity !== null && pendingQuantity === snapshot.quantity ? null : pendingQuantity,
      past_due_since: pastDueSince,
      last_reconciled_at: now.toISOString(),
    });
    const row = await deps.repo.updateSubscription(sub.id, {
      ...patch,
      plan: planChanged ? snapshot.plan : sub.plan,
      quantity: quantityChanged ? snapshot.quantity : Number(sub.quantity),
      unit_amount_minor:
        planChanged && snapshot.unitAmountMinor > 0
          ? snapshot.unitAmountMinor
          : Number(sub.unit_amount_minor),
    });
    const business = await deps.getBusiness(sub.business_id);
    if (planChanged) await deps.repo.setPlan({ businessId: sub.business_id, plan: snapshot.plan });
    if (planChanged || quantityChanged || snapshot.status !== sub.status)
      await record(sub.business_id, "subscription.changed", {
        source,
        from_plan: sub.plan,
        to_plan: planChanged ? snapshot.plan : sub.plan,
        from_quantity: Number(sub.quantity),
        to_quantity: snapshot.quantity,
        from_status: sub.status,
        to_status: snapshot.status,
        cancel_at: snapshot.cancelAt,
      });
    if (business) {
      if (snapshot.status === "past_due") {
        if (business.billing_status === "active")
          await deps.repo.setBillingStatus({ businessId: sub.business_id, status: "past_due" });
        if (sub.status !== "past_due")
          await record(sub.business_id, "subscription.past_due", {
            since: metaString(patch.metadata.past_due_since) ?? now.toISOString(),
            source,
          });
        const since = metaString(patch.metadata.past_due_since);
        if (
          business.billing_status === "past_due" &&
          since &&
          new Date(since).getTime() + PAST_DUE_GRACE_DAYS * DAY_MS <= now.getTime()
        ) {
          await deps.repo.lockBusiness({ businessId: sub.business_id, now, purgeAfter: null });
          await record(sub.business_id, "subscription.locked", { reason: "past_due", since });
        }
      } else if (
        snapshot.status === "active" &&
        (business.billing_status === "past_due" || business.billing_status === "locked") &&
        (sub.status === "past_due" || business.billing_status === "past_due")
      ) {
        await deps.repo.setBillingStatus({ businessId: sub.business_id, status: "active" });
      }
    }
    return row;
  }

  /**
   * Best-effort provider read for a subscription event; a failure here fails the event
   * so the provider redelivers it later.
   * @param {string} providerSubscriptionId
   */
  async function fetchSnapshot(providerSubscriptionId) {
    const provider = requireProvider();
    return provider.fetchSubscription(providerSubscriptionId);
  }

  /**
   * Applies one normalized event inside a platform transaction.
   * @param {BillingEvent} event
   * @returns {Promise<ApplyOutcome>}
   */
  async function applyEvent(event) {
    const now = deps.now();
    const provider = requireProvider();
    if (typeof provider.liveMode === "boolean" && event.liveMode !== provider.liveMode)
      return { handled: false, note: "live_mode_mismatch" };
    const sub = event.providerSubscriptionId
      ? await deps.repo.getSubscriptionByProviderId(provider.name, event.providerSubscriptionId)
      : null;
    /** @type {BillingCheckoutRow | null} */
    let checkout = event.providerCheckoutId
      ? await deps.repo.getCheckoutByProviderId(provider.name, event.providerCheckoutId)
      : null;
    if (
      !checkout &&
      event.metadata.checkout_id &&
      /^[0-9a-f-]{36}$/i.test(event.metadata.checkout_id)
    )
      checkout = await deps.repo.getCheckout(event.metadata.checkout_id);
    const metadataBusinessId =
      event.metadata.business_id && /^[0-9a-f-]{36}$/i.test(event.metadata.business_id)
        ? event.metadata.business_id
        : null;
    const businessId = sub?.business_id ?? checkout?.business_id ?? metadataBusinessId ?? null;

    switch (event.type) {
      case "payment_succeeded": {
        if (sub) {
          const snapshot = await fetchSnapshot(sub.provider_subscription_id).catch(() => null);
          if (snapshot && snapshot.status === "canceled") {
            await converge({ sub, snapshot, now, source: "webhook" });
          } else {
            const row = await recordRenewal({ sub, snapshot, event, now });
            if (checkout && checkout.status === "open") {
              await deps.repo.closeCheckout(checkout.id, "paid");
              await record(sub.business_id, "checkout.completed", { checkout_id: checkout.id });
            }
            await recordPayment({ businessId: sub.business_id, event, outcome: "succeeded" });
            return {
              handled: true,
              businessId: sub.business_id,
              subscriptionId: row?.id ?? sub.id,
            };
          }
          await recordPayment({ businessId: sub.business_id, event, outcome: "succeeded" });
          return { handled: true, businessId: sub.business_id, subscriptionId: sub.id };
        }
        if (businessId && event.providerSubscriptionId) {
          const snapshot = await fetchSnapshot(event.providerSubscriptionId).catch(() => null);
          const row = await activate({
            businessId,
            checkout,
            providerSubscriptionId: event.providerSubscriptionId,
            snapshot,
            event,
            now,
          });
          if (!row) return { handled: false, note: "plan_unresolved", businessId };
          await deps.repo.updateSubscription(row.id, {
            metadata: {
              ...meta(row.metadata),
              first_payment_at: event.occurredAt,
              last_payment_at: event.occurredAt,
              last_fee_minor: event.feeMinor ?? null,
              latest_tax_invoice_url: event.taxInvoiceUrl ?? null,
            },
          });
          await recordPayment({ businessId, event, outcome: "succeeded" });
          return { handled: true, businessId, subscriptionId: row.id };
        }
        if (checkout && checkout.status === "open") {
          // A paid checkout whose subscription id has not reached us yet: close the
          // checkout; subscription.create activates the business.
          await deps.repo.closeCheckout(checkout.id, "paid");
          await record(checkout.business_id, "checkout.completed", { checkout_id: checkout.id });
          await recordPayment({ businessId: checkout.business_id, event, outcome: "succeeded" });
          return { handled: true, businessId: checkout.business_id, note: "awaiting_subscription" };
        }
        return { handled: false, note: "unmatched_payment", businessId };
      }
      case "subscription_created": {
        if (!event.providerSubscriptionId)
          return { handled: false, note: "missing_subscription_id" };
        const snapshot = await fetchSnapshot(event.providerSubscriptionId).catch(() => null);
        if (sub) {
          const row = snapshot ? await converge({ sub, snapshot, now, source: "webhook" }) : sub;
          return { handled: true, businessId: sub.business_id, subscriptionId: row?.id ?? sub.id };
        }
        if (!businessId) return { handled: false, note: "unmatched_subscription" };
        const row = await activate({
          businessId,
          checkout,
          providerSubscriptionId: event.providerSubscriptionId,
          snapshot,
          event,
          now,
        });
        if (!row) return { handled: false, note: "plan_unresolved", businessId };
        return { handled: true, businessId, subscriptionId: row.id };
      }
      case "payment_failed":
      case "subscription_past_due": {
        if (sub) {
          const snapshot = await fetchSnapshot(sub.provider_subscription_id).catch(() => null);
          const row = await markPastDue({ sub, snapshot, event, now });
          if (event.type === "payment_failed")
            await recordPayment({ businessId: sub.business_id, event, outcome: "failed" });
          if (snapshot && snapshot.status === "canceled")
            await converge({ sub: row ?? sub, snapshot, now, source: "webhook" });
          return { handled: true, businessId: sub.business_id, subscriptionId: sub.id };
        }
        if (checkout && event.type === "payment_failed") {
          // The first charge of a checkout failed: the checkout stays open for a retry.
          await record(checkout.business_id, "checkout.payment_failed", {
            checkout_id: checkout.id,
            amount_minor: event.amountMinor ?? null,
          });
          return {
            handled: true,
            businessId: checkout.business_id,
            note: "checkout_payment_failed",
          };
        }
        return { handled: false, note: "unmatched_failure", businessId };
      }
      case "subscription_updated":
      case "subscription_canceled": {
        if (!sub) return { handled: false, note: "unmatched_subscription", businessId };
        const snapshot = await fetchSnapshot(sub.provider_subscription_id);
        if (event.type === "subscription_canceled" && snapshot.status !== "canceled") {
          // The provider says cancelled; trust the event when the read lags behind.
          snapshot.status = "canceled";
        }
        const row = await converge({ sub, snapshot, now, source: "webhook" });
        return { handled: true, businessId: sub.business_id, subscriptionId: row?.id ?? sub.id };
      }
      case "refund_created": {
        if (!businessId) return { handled: false, note: "unmatched_refund" };
        await recordPayment({ businessId, event, outcome: "refunded" });
        return { handled: true, businessId, subscriptionId: sub?.id ?? null };
      }
      case "dispute_opened": {
        if (!businessId) return { handled: false, note: "unmatched_dispute" };
        await record(businessId, "payment.disputed", {
          intent_id: event.id,
          amount_minor: event.amountMinor ?? null,
          currency: event.currency ?? null,
          occurred_at: event.occurredAt,
        });
        return { handled: true, businessId, subscriptionId: sub?.id ?? null };
      }
      case "checkout_completed": {
        if (!checkout) return { handled: false, note: "unmatched_checkout" };
        if (checkout.status === "open") {
          await deps.repo.closeCheckout(checkout.id, "paid");
          await record(checkout.business_id, "checkout.completed", { checkout_id: checkout.id });
        }
        return { handled: true, businessId: checkout.business_id };
      }
      default:
        return { handled: false, note: "ignored" };
    }
  }

  /**
   * Verifies, deduplicates and applies one webhook delivery. Resolves to the HTTP
   * outcome; it never throws for an unknown event type.
   * @param {{ provider: string, rawBody: string, headers: Record<string, string | string[] | undefined> }} input
   * @returns {Promise<WebhookResult>}
   */
  async function handleWebhook({ provider: name, rawBody, headers }) {
    const provider = deps.provider;
    if (!provider || provider.name !== name) {
      deps.countEvent("unconfigured");
      return {
        status: 503,
        body: { error: "Proveedor de pagos no configurado", code: "BILLING_UNAVAILABLE" },
      };
    }
    if (typeof rawBody !== "string" || !rawBody)
      return { status: 400, body: { error: "Cuerpo vacío", code: "BAD_JSON" } };
    /** @type {Record<string, string | undefined>} */
    const flatHeaders = {};
    for (const [key, value] of Object.entries(headers || {}))
      flatHeaders[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    const verified = await provider.verifyWebhook({ rawBody, headers: flatHeaders });
    if (!verified) {
      deps.countEvent("invalid_signature");
      return {
        status: 401,
        body: { error: "Firma del webhook inválida", code: "WEBHOOK_SIGNATURE_INVALID" },
      };
    }
    const event = provider.parseEvent(rawBody);
    const eventId = headerValue(flatHeaders, "svix-id") ?? event.id;
    const raw = isRecord(event.raw) ? event.raw : {};
    const providerEventType = typeof raw.event_type === "string" ? raw.event_type : event.type;
    return deps.platform(async () => {
      let row = await deps.repo.insertProviderEvent({
        id: deps.uuid(),
        provider: provider.name,
        providerEventId: eventId,
        eventType: providerEventType,
        liveMode: event.liveMode,
        payload: event.raw,
      });
      if (!row) {
        const existing = await deps.repo.getProviderEvent(provider.name, eventId);
        const reclaimed =
          existing && existing.status === "failed"
            ? await deps.repo.reclaimFailedProviderEvent(existing.id)
            : null;
        if (!reclaimed) {
          deps.countEvent("duplicate");
          return { status: 200, body: { ok: true, duplicate: true } };
        }
        row = reclaimed;
      }
      if (event.type === "ignored") {
        await deps.repo.finishProviderEvent(row.id, {
          status: "ignored",
          error: "unmapped_event_type",
        });
        deps.countEvent("ignored");
        return { status: 200, body: { ok: true, type: "ignored", event_type: providerEventType } };
      }
      try {
        const outcome = await deps.transaction(() => applyEvent(event));
        await deps.repo.finishProviderEvent(row.id, {
          status: outcome.handled ? "processed" : "ignored",
          error: outcome.handled ? null : (outcome.note ?? null),
          businessId: outcome.businessId ?? null,
          subscriptionId: outcome.subscriptionId ?? null,
        });
        deps.countEvent(outcome.handled ? event.type : "ignored");
        return {
          status: 200,
          body: {
            ok: true,
            type: event.type,
            handled: outcome.handled,
            ...(outcome.note ? { note: outcome.note } : {}),
          },
        };
      } catch (error) {
        await deps.repo
          .finishProviderEvent(row.id, { status: "failed", error: errorMessage(error) })
          .catch(() => {});
        deps.countEvent("failed");
        deps.log.warn(
          { provider: provider.name, eventType: providerEventType, err: errorMessage(error) },
          "Billing webhook event failed; the provider will redeliver it",
        );
        return {
          status: 500,
          body: { error: "No se pudo procesar el evento", code: "BILLING_WEBHOOK_FAILED" },
        };
      }
    });
  }

  // ---------------------------------------------------------------------------------
  // Branch-count hook and daily reconcile

  /**
   * Re-takes the branch count after a branch change and moves the subscription
   * quantity (section 6). Failure tolerant: logs, records `subscription.sync_failed`
   * and never throws, so the branch change itself is never blocked.
   * @param {{ businessId: string, reason: "branch_added" | "branch_removed" | "manual" }} input
   */
  async function syncBranchQuantity({ businessId, reason }) {
    try {
      const sub = await deps.platform(() => deps.repo.activeSubscription(businessId));
      if (!sub || sub.provider === "manual") return { skipped: "no_provider_subscription" };
      const provider = providerFor(sub.provider);
      if (!provider) return { skipped: "provider_unconfigured" };
      const branches = await countBranches(businessId);
      const target = quantityForBranches(branches);
      if (!target.ok) {
        await record(businessId, "subscription.sync_failed", {
          reason,
          code: "BILLING_QUANTITY_LIMIT",
          branches,
        });
        return { failed: "BILLING_QUANTITY_LIMIT" };
      }
      if (target.quantity === Number(sub.quantity)) return { skipped: "unchanged" };
      const mode = prorationMode({
        fromPlan: sub.plan,
        toPlan: sub.plan,
        fromQuantity: Number(sub.quantity),
        toQuantity: target.quantity,
      });
      const snapshot = await provider.changeSubscription(sub.provider_subscription_id, {
        quantity: target.quantity,
        mode,
      });
      const applied = snapshot.quantity === target.quantity;
      await deps.platform(() =>
        deps.repo.updateSubscription(sub.id, {
          ...patchFromSnapshot(sub, snapshot, {
            pending_quantity: applied ? null : target.quantity,
            pending_mode: applied ? null : mode,
          }),
          quantity: applied ? target.quantity : Number(sub.quantity),
        }),
      );
      await record(businessId, "subscription.changed", {
        reason,
        from_quantity: Number(sub.quantity),
        to_quantity: target.quantity,
        mode,
        applied,
      });
      return { changed: true, quantity: target.quantity, mode, applied };
    } catch (error) {
      deps.log.warn(
        { businessId, reason, err: errorMessage(error) },
        "Branch count could not be synced to the subscription",
      );
      await record(businessId, "subscription.sync_failed", {
        reason,
        error: errorMessage(error),
      }).catch(() => {});
      return { failed: "SYNC_ERROR" };
    }
  }

  /**
   * Daily `billing.reconcile` (worker): expires stale checkouts, converges every
   * provider-backed open subscription on a fresh read, applies the past-due grace lock
   * and locks businesses whose canceled subscription has ended.
   * @param {{ now?: Date }} [options]
   */
  async function reconcileOnce({ now = deps.now() } = {}) {
    const summary = {
      checkouts_expired: 0,
      subscriptions_checked: 0,
      subscriptions_skipped: 0,
      failures: 0,
      locked_after_cancel: 0,
    };
    const expired = await deps.platform(() => deps.repo.expireStaleCheckouts(now));
    for (const checkout of expired) {
      summary.checkouts_expired += 1;
      await record(checkout.business_id, "checkout.expired", { checkout_id: checkout.id }).catch(
        () => {},
      );
    }
    const subscriptions = await deps.platform(() => deps.repo.listForReconcile());
    for (const sub of subscriptions) {
      const provider = providerFor(sub.provider);
      if (!provider) {
        summary.subscriptions_skipped += 1;
        continue;
      }
      try {
        const snapshot = await provider.fetchSubscription(sub.provider_subscription_id);
        await deps.platform(() =>
          deps.transaction(() => converge({ sub, snapshot, now, source: "reconcile" })),
        );
        summary.subscriptions_checked += 1;
      } catch (error) {
        summary.failures += 1;
        deps.log.warn(
          { businessId: sub.business_id, subscriptionId: sub.id, err: errorMessage(error) },
          "Subscription reconcile failed for a business",
        );
      }
    }
    const ended = await deps.platform(() => deps.repo.listCanceledPastEnd(now));
    for (const sub of ended) {
      try {
        const locked = await deps.platform(() =>
          deps.repo.lockBusiness({
            businessId: sub.business_id,
            now,
            purgeAfter: retentionDate(now),
          }),
        );
        if (locked) {
          summary.locked_after_cancel += 1;
          deps.countTransition("locked");
          await record(sub.business_id, "subscription.locked", {
            reason: "canceled",
            cancel_at: iso(sub.cancel_at),
            purge_after: retentionDate(now).toISOString(),
          });
        }
      } catch (error) {
        summary.failures += 1;
        deps.log.warn(
          { businessId: sub.business_id, err: errorMessage(error) },
          "Post-cancel lock failed for a business",
        );
      }
    }
    deps.log.info(summary, "Billing reconcile completed");
    return summary;
  }

  // ---------------------------------------------------------------------------------
  // Super: catalog sync

  /**
   * Creates the Recurrente products for both currencies (three USD plans for businesses
   * outside Guatemala, three GTQ plans for Guatemalan businesses: six products) and stores
   * their price ids in `billing_catalog`. Existing ids are kept unless `force`.
   * @param {{ force?: boolean }} [options]
   */
  async function syncCatalog({ force = false } = {}) {
    const provider = requireProvider();
    const catalog = await deps.getCatalog();
    /** @type {Array<{ currency: Currency, plan: PlanName, price_id: string, product_id: string }>} */
    const created = [];
    /** @type {Array<{ currency: Currency, plan: PlanName, price_id: string }>} */
    const kept = [];
    const next = structuredClone(catalog);
    /** @type {Currency[]} */
    const currencies = ["USD", "GTQ"];
    for (const currency of currencies) {
      const amounts = currency === "GTQ" ? catalog.gtq : catalog.usd;
      if (!amounts) continue;
      for (const plan of PLAN_NAMES) {
        const existing = next.providers.recurrente.price_ids[currency][plan];
        if (existing && !force) {
          kept.push({ currency, plan, price_id: existing });
          continue;
        }
        const product = await provider.createProduct({
          name: `PuntosFieles ${PLAN_DISPLAY_NAMES[plan]} (${currency})`,
          description: `Plan ${PLAN_DISPLAY_NAMES[plan]} de PuntosFieles: ${currency} ${amounts[plan]} por sucursal al mes, IVA incluido.`,
          plan,
          currency,
          unitAmountMinor: Math.round(Number(amounts[plan]) * 100),
          billingInfoRequired: false, // PF does not issue FEL invoices (2026-11-26): never collect the NIT
        });
        next.providers.recurrente.price_ids[currency][plan] = product.priceId;
        created.push({ currency, plan, price_id: product.priceId, product_id: product.productId });
      }
    }
    const saved = created.length ? await deps.setCatalog(next) : catalog;
    deps.countEvent("catalog.synced");
    return { created, kept, catalog: saved, live_mode: provider.liveMode };
  }

  return {
    providerName,
    isConfigured,
    overview,
    invoices,
    startCheckout,
    checkoutStatus,
    changePlan,
    cancel,
    superCancel,
    handleWebhook,
    applyEvent,
    syncBranchQuantity,
    reconcileOnce,
    syncCatalog,
  };
}

/** @typedef {ReturnType<typeof createSubscriptionService>} SubscriptionService */

/** @type {SubscriptionService | null} */
let shared = null;
/** The process-wide service bound to the configured provider (lazy, so tests never build it). */
export function subscriptionService() {
  shared ??= createSubscriptionService();
  return shared;
}
