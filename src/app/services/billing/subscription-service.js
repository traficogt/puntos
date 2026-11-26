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
// - New subscriptions use the merchant's operating country: GTQ through Recurrente
//   in Guatemala, USD through Stripe elsewhere. Existing contracts keep their processor.
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

import { createStripeProvider } from "./stripe-provider.js";

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
 *   saveCatalogPrices: (provider: "stripe"|"recurrente", catalog: ResolvedCatalog) => Promise<ResolvedCatalog>,
 *   provider: OnlineProvider | null,
 *   stripeProvider: import("./stripe-provider.js").StripeProvider | null,
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
  if (!["recurrente", "stripe"].includes(config.BILLING_PROVIDER) || !secretKey) return null;
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
    saveCatalogPrices: (provider, catalog) =>
      BillingCatalogService.saveProviderPrices(provider, catalog),
    provider: onlineProvider(config.RECURRENTE_SECRET_KEY, config.RECURRENTE_WEBHOOK_SECRET),
    stripeProvider:
      ["recurrente", "stripe"].includes(config.BILLING_PROVIDER) && config.STRIPE_SECRET_KEY
        ? createStripeProvider({
            fetch: globalThis.fetch,
            config: {
              secretKey: config.STRIPE_SECRET_KEY,
              webhookSecret: config.STRIPE_WEBHOOK_SECRET,
              apiBase: config.STRIPE_API_BASE,
              getCatalog: () => BillingCatalogService.get(),
            },
          })
        : null,
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
 * @param {string} [usdProvider]
 */
export function catalogReadiness(catalog, usdProvider = "stripe") {
  const priceIds = catalog.providers.recurrente.price_ids;
  const usd = PLAN_NAMES.every(
    (plan) =>
      Boolean(
        (usdProvider === "recurrente" ? priceIds : catalog.providers.stripe.price_ids).USD[plan],
      ) && catalog.usd[plan] > 0,
  );
  const gtq =
    Boolean(catalog.gtq) &&
    PLAN_NAMES.every((plan) => Boolean(priceIds.GTQ[plan]) && Number(catalog.gtq?.[plan]) > 0);
  return { usd, gtq };
}

/**
 * Explicit operating country wins. Use the verified phone when the region is
 * unknown, then a stored billing currency or the platform's Guatemala default.
 * @param {Pick<BusinessRow, "billing_currency" | "program_json" | "trial_phone">} business
 */
export function businessPaysInGtq(business) {
  const country = meta(business.program_json?.region).country;
  if (typeof country === "string" && Object.hasOwn(REGIONAL_COUNTRIES, country))
    return country === "GT";
  const phone = String(business.trial_phone ?? "").replace(/^\+/, "");
  if (phone) return phone.startsWith(REGIONAL_COUNTRIES.GT.dialCode);
  return business.billing_currency !== "USD";
}

/**
 * Currency for a new checkout or an existing contract's plan changes.
 * @param {{ business: Pick<BusinessRow, "billing_currency" | "program_json" | "trial_phone">, catalog?: ResolvedCatalog, active?: { currency: string } | null }} input
 * @returns {Currency}
 */
export function defaultCurrency({ business, active = null }) {
  if (active) return active.currency === "GTQ" ? "GTQ" : "USD";
  return businessPaysInGtq(business) ? "GTQ" : "USD";
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
  const isConfigured = () => Boolean(deps.provider || deps.stripeProvider);

  /** @param {string} name */
  function onlineFor(name) {
    if (name === "recurrente") return deps.provider;
    if (name === "stripe") return deps.stripeProvider;
    return null;
  }

  /** @param {string} name */
  function providerFor(name) {
    return name === "manual" ? deps.manualProvider : onlineFor(name);
  }

  /** @param {Currency} currency */
  function checkoutProvider(currency) {
    const provider = currency === "GTQ" ? deps.provider : deps.stripeProvider;
    return provider?.webhookConfigured === false ? null : provider;
  }

  /** @param {BusinessRow} business @param {BillingSubscriptionRow | null} active @param {ResolvedCatalog} catalog */
  function canStartCheckout(business, active, catalog) {
    const currency = defaultCurrency({ business, catalog });
    const ready = catalogReadiness(catalog);
    return (
      !active && Boolean(checkoutProvider(currency)) && (currency === "USD" ? ready.usd : ready.gtq)
    );
  }

  /** @param {BusinessRow} business @param {BillingSubscriptionRow | null} active */
  async function upgradeAvailable(business, active) {
    return isConfigured() && !active && canStartCheckout(business, active, await deps.getCatalog());
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

  /** @template T @param {string} businessId @param {() => Promise<T>} fn */
  function withBillingLock(businessId, fn) {
    return deps.platform(() =>
      deps.transaction(async () => {
        await deps.repo.lockBusinessForBilling(businessId);
        return fn();
      }),
    );
  }

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
   * @param {{ requested: string | null | undefined, business: BusinessRow, catalog: ResolvedCatalog }} input
   * @returns {Currency}
   */
  function resolveCurrency({ requested, business, catalog }) {
    const currency = defaultCurrency({ business });
    if (requested && requested !== currency)
      throw badRequest(
        "Esta moneda no está disponible para tu negocio.",
        "BILLING_CURRENCY_UNAVAILABLE",
      );
    const ready = catalogReadiness(catalog);
    if (!(currency === "GTQ" ? ready.gtq : ready.usd)) throw unavailable();
    return currency;
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
    // The plan page quotes in the currency the business pays or will pay (header rule).
    const currency = defaultCurrency({ business, catalog, active });
    const manageable = Boolean(
      active && onlineFor(active.provider) && ["active", "past_due"].includes(active.status),
    );
    const activeReady = catalogReadiness(catalog, active?.provider);
    const canChange = manageable && (currency === "GTQ" ? activeReady.gtq : activeReady.usd);
    const canCheckout = canStartCheckout(business, active, catalog);
    const state = trialState(business, { now, timezone: regionTimezone(business) });
    const view = subscription ? subscriptionView(subscription) : null;
    const currentView = active ? view : null;
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
        provider: active?.provider ?? checkoutProvider(currency)?.name ?? null,
        currency,
        plan: business.plan,
        plan_name: planDisplayName(business.plan),
        quantity: currentView?.quantity ?? quantityForBranches(branches).quantity,
        unit_amount_minor:
          currentView?.unit_amount_minor ??
          catalogPlans(catalog, currency).find((p) => p.id === normalizePlan(business.plan))
            ?.unit_amount_minor ??
          null,
        monthly_total_minor: currentView?.monthly_total_minor ?? null,
        current_period_start: view?.current_period_start ?? null,
        current_period_end: view?.current_period_end ?? null,
        cancel_at: view?.cancel_at ?? null,
        past_due_since: view?.past_due_since ?? null,
        next_payment_attempt_at: view?.next_payment_attempt_at ?? null,
        latest_tax_invoice_url: view?.latest_tax_invoice_url ?? null,
        upgrade_available: canCheckout,
        change_available: canChange,
        cancel_available: manageable,
        checkout_pending:
          pending &&
          pending.currency === currency &&
          pending.provider === (currency === "GTQ" ? "recurrente" : "stripe")
            ? { id: pending.id, url: pending.checkout_url, expires_at: iso(pending.expires_at) }
            : null,
        lock_reason: lockReason,
        subscription: view,
      },
      catalog: {
        currency,
        currencies: canChange || canCheckout ? [currency] : [],
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
    return withBillingLock(businessId, () => createCheckout(businessId, plan, currency));
  }

  /** @param {string} businessId @param {string} plan @param {string | null} currency */
  async function createCheckout(businessId, plan, currency) {
    const now = deps.now();
    const business = await deps.getBusiness(businessId);
    if (!business) throw notFound("Negocio no encontrado");
    const planKey = requirePlan(plan);
    const catalog = await deps.getCatalog();
    const active = await deps.repo.activeSubscription(businessId);
    if (active)
      throw conflict(
        "Tu negocio ya tiene un plan activo; cambia de plan en lugar de iniciar otro pago.",
        "BILLING_ALREADY_ACTIVE",
      );
    const chosen = resolveCurrency({ requested: currency, business, catalog });
    const provider = checkoutProvider(chosen);
    if (!provider) throw unavailable();
    const branches = await countBranches(businessId);
    const quantity = quantityForBranches(branches);
    if (!quantity.ok)
      throw conflict(
        `El pago en línea cubre hasta ${MAX_QUANTITY} sucursales; escríbenos para un plan a medida.`,
        "BILLING_QUANTITY_LIMIT",
      );
    if (branches > planLimits(planKey).branches)
      throw conflict(
        `El plan ${PLAN_DISPLAY_NAMES[planKey]} admite hasta ${planLimits(planKey).branches} sucursales.`,
        "BILLING_PLAN_LIMITS",
      );
    const pending = await deps.repo.findOpenCheckout({
      businessId,
      now,
      plan: planKey,
      currency: chosen,
      quantity: quantity.quantity,
    });
    if (pending?.provider === provider.name)
      return { reused: true, checkout: checkoutView(pending) };

    const open = await deps.repo.findOpenCheckout({ businessId, now });
    if (open && (provider.name === "stripe" || open.provider === "stripe"))
      throw conflict(
        "Ya hay un pago pendiente. Complétalo o espera a que venza.",
        "BILLING_CHECKOUT_PENDING",
      );

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
      subscription:
        subscription?.checkout_id === checkoutId ? subscriptionView(subscription) : null,
    };
  }

  // ---------------------------------------------------------------------------------
  // Plan changes and cancellation

  /** @param {{ businessId: string, plan: string }} input */
  async function changePlan({ businessId, plan }) {
    return withBillingLock(businessId, async () => {
      const planKey = requirePlan(plan);
      const sub = await deps.repo.activeSubscription(businessId);
      if (!sub) throw notFound("Tu negocio no tiene un plan activo.", "BILLING_NO_SUBSCRIPTION");
      const provider = providerFor(sub.provider);
      if (!provider || sub.provider === "manual")
        throw conflict(
          "Tu plan actual lo gestiona el equipo de PuntosFieles; escríbenos para cambiarlo.",
          "BILLING_PROVIDER_MISMATCH",
        );
      if (!["active", "past_due"].includes(sub.status)) throw unavailable();
      if (normalizePlan(sub.plan) === planKey && !meta(sub.metadata).pending_plan)
        return subscriptionView(sub);
      const catalog = await deps.getCatalog();
      const ready = catalogReadiness(catalog, sub.provider);
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
        ...(sub.provider === "stripe" ? {} : { quantity: Number(sub.quantity) }),
        mode,
      });
      const applied =
        normalizePlan(snapshot.plan) === planKey &&
        (sub.provider !== "stripe" || stripePaid(snapshot, deps.now()));
      const updated = await deps.repo.updateSubscription(sub.id, {
        ...patchFromSnapshot(sub, snapshot, {
          pending_plan: applied ? null : planKey,
          pending_mode: applied ? null : mode,
          unit_amount_minor_pending: applied ? null : snapshot.unitAmountMinor,
        }),
        plan: applied ? planKey : sub.plan,
        unit_amount_minor: applied ? snapshot.unitAmountMinor : Number(sub.unit_amount_minor),
      });
      if (applied) await deps.repo.setPlan({ businessId, plan: planKey });
      await record(businessId, "subscription.changed", {
        from_plan: sub.plan,
        to_plan: planKey,
        mode,
        applied,
        quantity: Number(sub.quantity),
      });
      return subscriptionView(updated ?? sub);
    });
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
    const result = await cancelSubscription(businessId, atPeriodEnd, by, "owner");
    return result.subscription;
  }

  /** @param {{ businessId: string, atPeriodEnd?: boolean, by?: string | null }} input */
  async function superCancel({ businessId, atPeriodEnd = false, by = null }) {
    return cancelSubscription(businessId, atPeriodEnd, by, "super");
  }

  /** @param {string} businessId @param {boolean} atPeriodEnd @param {string|null} by @param {"owner"|"super"} actor */
  function cancelSubscription(businessId, atPeriodEnd, by, actor) {
    return withBillingLock(businessId, async () => {
      const now = deps.now();
      const sub = await deps.repo.activeSubscription(businessId);
      if (!sub) throw notFound("El negocio no tiene un plan activo.", "BILLING_NO_SUBSCRIPTION");
      const provider = providerFor(sub.provider);
      if (!provider) throw unavailable();
      const snapshot = await provider.cancel(sub.provider_subscription_id, {
        atPeriodEnd,
        reason: by ? `${actor}:${by}` : actor,
      });
      if (atPeriodEnd && snapshot.status !== "canceled") {
        const cancelAt = snapshot.cancelAt ?? iso(sub.current_period_end);
        const updated = await deps.repo.updateSubscription(sub.id, {
          ...patchFromSnapshot(sub, snapshot, { cancel_requested_at: now.toISOString() }),
          cancel_at: cancelAt,
        });
        await record(businessId, "subscription.cancel_requested", { cancel_at: cancelAt, by });
        return { subscription: subscriptionView(updated ?? sub), ended: false };
      }
      const { row, ended } = await finalizeCancel({ sub, snapshot, reason: actor, now });
      await record(businessId, "subscription.canceled", { reason: actor, by });
      return { subscription: subscriptionView(row ?? sub), ended };
    });
  }

  // ---------------------------------------------------------------------------------
  // Webhook state machine

  /**
   * @param {{ checkout: BillingCheckoutRow, snapshot: SubscriptionSnapshot, event: BillingEvent, now: Date }} input
   */
  async function activate({ checkout, snapshot, event, now }) {
    const {
      business_id: businessId,
      provider,
      quantity,
      currency,
      unit_amount_minor: unitAmountMinor,
      plan,
    } = checkout;
    const business = await deps.getBusiness(businessId);
    if (!business) return null;
    const providerSubscriptionId = snapshot.providerSubscriptionId;
    /** @type {Record<string, unknown>} */
    const metadata = {
      checkout_id: checkout.id,
      activated_at: now.toISOString(),
      activated_by_event: event.type,
      live_mode: event.liveMode,
    };
    for (const [key, value] of Object.entries(snapshot.metadata))
      if (key.startsWith("provider_")) metadata[key] = value;
    const wasTrial = business.trial_status === "active" || business.trial_status === "expired";
    const row = await deps.repo.insertSubscription({
      id: deps.uuid(),
      businessId,
      provider,
      providerSubscriptionId,
      checkoutId: checkout.id,
      plan,
      quantity,
      currency,
      unitAmountMinor,
      status: "active",
      currentPeriodStart: snapshot?.currentPeriodStart ?? now,
      currentPeriodEnd: snapshot?.currentPeriodEnd ?? null,
      cancelAt: snapshot?.cancelAt ?? null,
      metadata,
    });

    await deps.repo.closeCheckout(checkout.id, "paid");
    await deps.repo.abandonOtherOpenCheckouts(businessId, checkout.id);
    await deps.repo.activateBusiness({ businessId, plan, currency });
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
      invoice_id: event.invoiceId ?? null,
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
   * Record the confirmed first payment or renewal and recover access after a successful retry.
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

  /** @param {SubscriptionSnapshot} snapshot @param {Date} now */
  function stripePaid(snapshot, now) {
    return (
      snapshot.status === "active" &&
      snapshot.metadata.provider_invoice_paid === "true" &&
      snapshot.metadata.provider_usd_monthly === "true" &&
      snapshot.unitAmountMinor > 0 &&
      snapshot.currentPeriodEnd &&
      new Date(snapshot.currentPeriodEnd) > now
    );
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
    if (sub.provider === "stripe" && snapshot.status === "active" && !stripePaid(snapshot, now))
      return sub;
    if (sub.provider === "stripe" && snapshot.status === "paused") {
      await deps.repo.lockBusiness({ businessId: sub.business_id, now, purgeAfter: null });
      return deps.repo.updateSubscription(sub.id, patchFromSnapshot(sub, snapshot));
    }
    const previous = meta(sub.metadata);
    const planChanged =
      (sub.provider !== "stripe" || stripePaid(snapshot, now)) &&
      isPlanName(snapshot.plan) &&
      normalizePlan(sub.plan) !== snapshot.plan;
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
        sub.provider === "stripe" &&
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
   * Apply a verified delivery under the business row lock. Remote metadata can
   * identify a checkout to look up, but local rows establish the owner.
   * @param {BillingEvent} event @param {NonNullable<ReturnType<typeof onlineFor>>} provider
   * @returns {Promise<ApplyOutcome>}
   */
  async function applyEvent(event, provider) {
    const now = deps.now();
    const stripe = provider.name === "stripe";
    if (event.liveMode !== provider.liveMode) return { handled: false, note: "live_mode_mismatch" };
    if (event.type === "ignored") return { handled: false, note: "unmapped_event_type" };
    const localId = event.metadata.checkout_id;
    const checkout = event.providerCheckoutId
      ? await deps.repo.getCheckoutByProviderId(provider.name, event.providerCheckoutId)
      : localId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(localId)
        ? await deps.repo.getCheckout(localId)
        : null;
    if (
      stripe &&
      event.type === "dispute_opened" &&
      !event.providerCustomerId &&
      event.providerChargeId &&
      deps.stripeProvider
    )
      event.providerCustomerId =
        (await deps.stripeProvider.chargeCustomer(event.providerChargeId)) ?? undefined;
    if (
      !stripe &&
      event.type === "payment_succeeded" &&
      !event.providerSubscriptionId &&
      checkout?.provider === provider.name
    ) {
      const remote = await provider.fetchCheckout(checkout.provider_checkout_id);
      if (remote.status === "paid" && remote.subscriptionId)
        event.providerSubscriptionId = remote.subscriptionId;
      else throw new Error("Paid checkout awaiting subscription");
    }
    const customer = event.providerCustomerId
      ? await deps.repo.getCustomerByProviderId(provider.name, event.providerCustomerId)
      : null;
    let sub = event.providerSubscriptionId
      ? await deps.repo.getSubscriptionByProviderId(provider.name, event.providerSubscriptionId)
      : null;
    const businessId = sub?.business_id ?? checkout?.business_id ?? customer?.business_id;
    if (!businessId)
      return {
        handled: false,
        note: event.type === "payment_succeeded" ? "unmatched_payment" : "unmatched_event",
      };
    if (
      ((stripe || event.providerCustomerId) && !customer) ||
      (customer && customer.business_id !== businessId) ||
      (event.metadata.business_id && event.metadata.business_id !== businessId) ||
      (checkout &&
        (checkout.provider !== provider.name ||
          checkout.business_id !== businessId ||
          (localId && localId !== checkout.id))) ||
      (sub && checkout && sub.checkout_id !== checkout.id)
    )
      return { handled: false, note: "ownership_mismatch" };

    await deps.repo.lockBusinessForBilling(businessId);
    if (event.providerSubscriptionId)
      sub = await deps.repo.getSubscriptionByProviderId(
        provider.name,
        event.providerSubscriptionId,
      );
    const active = await deps.repo.activeSubscription(businessId);
    if (
      sub &&
      (sub.business_id !== businessId ||
        (active && sub.id !== active.id) ||
        sub.status === "canceled") &&
      event.type !== "refund_created" &&
      event.type !== "dispute_opened"
    )
      return { handled: false, note: "superseded_subscription", businessId };

    switch (event.type) {
      case "payment_succeeded": {
        if (
          !event.providerSubscriptionId ||
          (!sub && (!checkout || active)) ||
          !event.amountMinor ||
          event.amountMinor < 0 ||
          event.currency !== (sub ?? checkout)?.currency
        )
          return { handled: false, note: "unmatched_payment", businessId };
        const snapshot = await provider.fetchSubscription(event.providerSubscriptionId);
        if (
          snapshot.providerSubscriptionId !== event.providerSubscriptionId ||
          snapshot.status !== "active" ||
          snapshot.currency !== event.currency ||
          (snapshot.metadata.business_id && snapshot.metadata.business_id !== businessId) ||
          (stripe &&
            (!stripePaid(snapshot, now) ||
              snapshot.metadata.provider_latest_invoice !== event.invoiceId ||
              Number(snapshot.metadata.provider_invoice_amount_paid) !== event.amountMinor ||
              snapshot.metadata.provider_customer_id !== event.providerCustomerId))
        )
          return { handled: false, note: "ineligible_subscription", businessId };
        let row = sub;
        if (!row) {
          const current = checkout && (await deps.repo.getCheckout(checkout.id));
          if (
            !current ||
            current.status !== "open" ||
            !customer ||
            current.plan !== snapshot.plan ||
            current.quantity !== snapshot.quantity ||
            current.unit_amount_minor !== snapshot.unitAmountMinor ||
            event.amountMinor !== current.unit_amount_minor * current.quantity ||
            (snapshot.metadata.checkout_id && snapshot.metadata.checkout_id !== current.id)
          )
            return { handled: false, note: "checkout_mismatch", businessId };
          if (await deps.repo.hasContractAfterCheckout(current.id))
            return { handled: false, note: "superseded_checkout", businessId };
          const branches = await countBranches(businessId);
          if (
            branches > planLimits(current.plan).branches ||
            Math.max(1, branches) !== current.quantity
          )
            return { handled: false, note: "branch_count_changed", businessId };
          if (stripe) {
            const session = await provider.fetchCheckout(current.provider_checkout_id);
            const raw = meta(session.raw);
            if (
              session.id !== current.provider_checkout_id ||
              session.subscriptionId !== snapshot.providerSubscriptionId ||
              session.status !== "complete" ||
              raw.payment_status !== "paid" ||
              raw.customer !== event.providerCustomerId ||
              raw.mode !== "subscription"
            )
              return { handled: false, note: "session_mismatch", businessId };
          }
          row = await activate({ checkout: current, snapshot, event, now });
          if (!row) return { handled: false, note: "unmatched_business" };
        }
        if (
          stripe &&
          event.invoiceId &&
          (await deps.tenant(businessId, () =>
            deps.repo.hasPaidInvoice(businessId, String(event.invoiceId)),
          ))
        )
          return {
            handled: true,
            note: "invoice_already_recorded",
            businessId,
            subscriptionId: row.id,
          };
        const renewed = await recordRenewal({ sub: row, snapshot, event, now });
        if (
          stripe &&
          renewed &&
          (renewed.plan !== snapshot.plan || Number(renewed.quantity) !== snapshot.quantity)
        )
          await converge({ sub: renewed, snapshot, now, source: "paid_invoice" });
        await recordPayment({ businessId, event, outcome: "succeeded" });
        return { handled: true, businessId, subscriptionId: row.id };
      }
      case "subscription_created":
      case "subscription_updated":
      case "subscription_canceled":
      case "subscription_past_due":
      case "payment_failed": {
        if (!sub) {
          if (checkout && event.type === "payment_failed")
            await record(businessId, "checkout.payment_failed", {
              checkout_id: checkout.id,
              amount_minor: event.amountMinor ?? null,
            });
          return { handled: false, note: "awaiting_paid_subscription", businessId };
        }
        const snapshot = await provider.fetchSubscription(sub.provider_subscription_id);
        if (
          snapshot.providerSubscriptionId !== sub.provider_subscription_id ||
          (snapshot.metadata.business_id && snapshot.metadata.business_id !== businessId) ||
          (stripe && snapshot.metadata.provider_customer_id !== event.providerCustomerId)
        )
          return { handled: false, note: "ownership_mismatch", businessId };
        if (event.type === "payment_failed")
          await recordPayment({ businessId, event, outcome: "failed" });
        if (snapshot.status === "past_due") await markPastDue({ sub, snapshot, event, now });
        else await converge({ sub, snapshot, now, source: "webhook" });
        return { handled: true, businessId, subscriptionId: sub.id };
      }
      case "refund_created": {
        await recordPayment({ businessId, event, outcome: "refunded" });
        return { handled: true, businessId, subscriptionId: sub?.id ?? null };
      }
      case "dispute_opened": {
        await record(businessId, "payment.disputed", {
          intent_id: event.id,
          amount_minor: event.amountMinor ?? null,
          currency: event.currency ?? null,
          occurred_at: event.occurredAt,
        });
        return { handled: true, businessId, subscriptionId: sub?.id ?? null };
      }
      case "checkout_expired": {
        if (!checkout) return { handled: false, note: "unmatched_checkout" };
        const expired = await deps.repo.closeCheckout(checkout.id, "expired");
        if (expired) await record(businessId, "checkout.expired", { checkout_id: checkout.id });
        return { handled: true, businessId };
      }
      case "checkout_completed":
        return { handled: false, note: "awaiting_paid_invoice", businessId };
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
    const provider = onlineFor(name);
    if (!provider || provider.webhookConfigured === false) {
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
    const eventId =
      name === "stripe" ? event.id : (headerValue(flatHeaders, "svix-id") ?? event.id);
    const raw = meta(event.raw);
    const providerEventType = String(raw.event_type ?? raw.type ?? event.type);
    return deps.platform(async () => {
      const inserted = await deps.repo.insertProviderEvent({
        id: deps.uuid(),
        provider: provider.name,
        providerEventId: eventId,
        eventType: providerEventType,
        liveMode: event.liveMode,
        payload: name === "stripe" ? { id: event.id, created_at: event.occurredAt } : event.raw,
      });
      try {
        return await deps.transaction(async () => {
          const row = await deps.repo.lockProviderEvent(provider.name, eventId);
          if (row.status === "processed" || row.status === "ignored") {
            deps.countEvent("duplicate");
            return { status: 200, body: { ok: true, duplicate: true } };
          }
          const outcome = await applyEvent(event, provider);
          await deps.repo.finishProviderEvent(row.id, {
            status: outcome.handled ? "processed" : "ignored",
            error: outcome.handled ? null : outcome.note,
            businessId: outcome.businessId,
            subscriptionId: outcome.subscriptionId,
            ...(name === "stripe" && outcome.handled && outcome.businessId
              ? {
                  payload: {
                    id: event.invoiceId ?? event.id,
                    created_at: event.occurredAt,
                    currency: event.currency ?? null,
                    amount_in_cents: event.amountMinor ?? null,
                    checkout: event.providerCheckoutId ? { id: event.providerCheckoutId } : null,
                    subscription: event.providerSubscriptionId
                      ? { id: event.providerSubscriptionId }
                      : null,
                    tax_invoice_url: event.taxInvoiceUrl ?? null,
                  },
                }
              : {}),
          });
          deps.countEvent(outcome.handled ? event.type : "ignored");
          return {
            status: 200,
            body:
              event.type === "ignored"
                ? { ok: true, type: "ignored", event_type: providerEventType }
                : {
                    ok: true,
                    type: event.type,
                    handled: outcome.handled,
                    ...(outcome.note ? { note: outcome.note } : {}),
                  },
          };
        });
      } catch (error) {
        const row = inserted ?? (await deps.repo.getProviderEvent(provider.name, eventId));
        if (row)
          await deps.repo
            .finishProviderEvent(row.id, {
              status: "failed",
              error: name === "stripe" ? "stripe_processing_failed" : errorMessage(error),
            })
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
      return await withBillingLock(businessId, async () => {
        const sub = await deps.repo.activeSubscription(businessId);
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
        const pendingQuantity = Number(meta(sub.metadata).pending_quantity) || null;
        if (target.quantity === (pendingQuantity ?? Number(sub.quantity)))
          return { skipped: "unchanged" };
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
        const applied =
          snapshot.quantity === target.quantity &&
          (sub.provider !== "stripe" || stripePaid(snapshot, deps.now()));
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
      });
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
        await withBillingLock(sub.business_id, async () => {
          const current = await deps.repo.activeSubscription(sub.business_id);
          if (current?.id !== sub.id) {
            summary.subscriptions_skipped += 1;
            return;
          }
          const snapshot = await provider.fetchSubscription(sub.provider_subscription_id);
          if (snapshot.providerSubscriptionId !== sub.provider_subscription_id)
            throw new Error("Subscription ID mismatch");
          if (sub.provider === "stripe") {
            const customer = await deps.repo.getCustomer(sub.business_id, "stripe");
            if (
              !customer ||
              customer.provider_customer_id !== snapshot.metadata.provider_customer_id
            )
              throw new Error("Subscription customer mismatch");
          }
          await converge({ sub: current, snapshot, now, source: "reconcile" });
          summary.subscriptions_checked += 1;
        });
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
        const locked = await withBillingLock(sub.business_id, async () => {
          const latest = await deps.repo.latestSubscription(sub.business_id);
          if (latest?.id !== sub.id || latest.status !== "canceled") return null;
          return deps.repo.lockBusiness({
            businessId: sub.business_id,
            now,
            purgeAfter: retentionDate(now),
          });
        });
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
   * @param {{ provider?: "stripe"|"recurrente", force?: boolean }} [options]
   */
  async function syncCatalog({ provider: name = "recurrente", force = false } = {}) {
    const provider = onlineFor(name);
    if (!provider) throw unavailable();
    const catalog = await deps.getCatalog();
    /** @type {Array<{ currency: Currency, plan: PlanName, price_id: string, product_id: string }>} */
    const created = [];
    /** @type {Array<{ currency: Currency, plan: PlanName, price_id: string }>} */
    const kept = [];
    const next = structuredClone(catalog);
    /** @type {Currency[]} */
    const currencies = name === "stripe" ? ["USD"] : ["USD", "GTQ"];
    for (const currency of currencies) {
      const amounts = currency === "GTQ" ? catalog.gtq : catalog.usd;
      if (!amounts) continue;
      for (const plan of PLAN_NAMES) {
        const priceIds =
          currency === "GTQ"
            ? next.providers.recurrente.price_ids.GTQ
            : next.providers[name].price_ids.USD;
        const existing = priceIds[plan];
        if (existing && !force) {
          kept.push({ currency, plan, price_id: existing });
          continue;
        }
        const product = await provider.createProduct(
          {
            name: `PuntosFieles ${PLAN_DISPLAY_NAMES[plan]} (${currency})`,
            description: `Plan ${PLAN_DISPLAY_NAMES[plan]} de PuntosFieles: ${currency} ${amounts[plan]} por sucursal al mes, IVA incluido.`,
            plan,
            currency,
            unitAmountMinor: Math.round(Number(amounts[plan]) * 100),
            billingInfoRequired: false, // PF does not issue FEL invoices (2026-11-26): never collect the NIT
          },
          { reuse: !force, previousPriceId: existing ?? null },
        );
        priceIds[plan] = product.priceId;
        created.push({ currency, plan, price_id: product.priceId, product_id: product.productId });
      }
    }
    const saved = created.length ? await deps.saveCatalogPrices(name, next) : catalog;
    deps.countEvent("catalog.synced");
    return { provider: name, created, kept, catalog: saved, live_mode: provider.liveMode };
  }

  return {
    upgradeAvailable,
    isConfigured,
    overview,
    invoices,
    startCheckout,
    checkoutStatus,
    changePlan,
    cancel,
    superCancel,
    handleWebhook,
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
