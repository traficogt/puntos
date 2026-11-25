// In-memory doubles for the billing adapter tests: the BillingSubscriptionRepo surface
// over plain arrays, a programmable provider that reuses the real Recurrente payload
// parser, and the recorded fixtures with their placeholder ids substituted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRecurrenteEvent,
  subscriptionSnapshot,
} from "../../../src/app/services/billing/recurrente-provider.js";
import { resolveBillingCatalog } from "../../../src/utils/plan.js";

export const FIXTURE_BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_CHECKOUT_ID = "22222222-2222-4222-8222-222222222222";
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "recurrente");

/**
 * @param {string} name file name under tests/fixtures/billing/recurrente
 * @param {{ businessId?: string, checkoutId?: string }} [ids]
 */
export function loadFixture(
  name,
  { businessId = FIXTURE_BUSINESS_ID, checkoutId = FIXTURE_CHECKOUT_ID } = {},
) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed fixture directory
  const text = fs.readFileSync(path.join(fixtureDir, name), "utf8");
  return JSON.parse(
    text.replaceAll(FIXTURE_BUSINESS_ID, businessId).replaceAll(FIXTURE_CHECKOUT_ID, checkoutId),
  );
}

/** A resolved catalog with Recurrente price ids for USD (and GTQ when amounts are given). */
export function fixtureCatalog({ gtq = null } = {}) {
  return resolveBillingCatalog({
    usd: { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 },
    gtq,
    providers: {
      recurrente: {
        price_ids: {
          USD: {
            EMPRENDEDOR: "price_emprendedor_usd",
            NEGOCIO: "price_negocio_usd",
            EMPRESA: "price_empresa_usd",
          },
          GTQ: gtq
            ? {
                EMPRENDEDOR: "price_emprendedor_gtq",
                NEGOCIO: "price_negocio_gtq",
                EMPRESA: "price_empresa_gtq",
              }
            : {},
        },
      },
    },
  });
}

const OPEN = new Set(["active", "past_due", "paused"]);
const toDate = (v) => (v == null ? null : v instanceof Date ? v : new Date(v));
// Reads hand out copies, as SQL result rows are, so a stored row only changes through
// the repository's own writes; the `state` arrays keep the live rows for assertions.
const copy = (row) =>
  row ? { ...row, metadata: row.metadata ? { ...row.metadata } : row.metadata } : null;

/**
 * BillingSubscriptionRepo over arrays. `state.businesses` is a Map of business rows the
 * access-state updates mutate in place.
 * @param {{ businesses?: Map<string, any> }} [seed]
 */
export function createMemoryBillingRepo(seed = {}) {
  const state = {
    businesses: seed.businesses ?? new Map(),
    customers: [],
    checkouts: [],
    subscriptions: [],
    providerEvents: [],
    paymentEvents: [],
  };
  const business = (id) => state.businesses.get(id) ?? null;
  const touch = (row) => Object.assign(row, { updated_at: new Date() });
  /** @type {any} */
  const repo = {
    state,
    async getCustomer(businessId, provider) {
      return (
        state.customers.find((c) => c.business_id === businessId && c.provider === provider) ?? null
      );
    },
    async upsertCustomer({
      businessId,
      provider,
      providerCustomerId,
      email,
      taxId = null,
      taxName = null,
    }) {
      let row = await repo.getCustomer(businessId, provider);
      if (!row) {
        row = { business_id: businessId, provider, created_at: new Date() };
        state.customers.push(row);
      }
      Object.assign(row, {
        provider_customer_id: providerCustomerId,
        email,
        tax_id: taxId,
        tax_name: taxName,
      });
      return row;
    },
    async insertCheckout(input) {
      const row = {
        id: input.id,
        business_id: input.businessId,
        provider: input.provider,
        provider_checkout_id: input.providerCheckoutId,
        plan: input.plan,
        quantity: input.quantity,
        currency: input.currency,
        unit_amount_minor: input.unitAmountMinor,
        status: "open",
        checkout_url: input.checkoutUrl,
        expires_at: toDate(input.expiresAt),
        created_at: new Date(),
      };
      state.checkouts.push(row);
      return row;
    },
    async getCheckout(id) {
      return copy(state.checkouts.find((c) => c.id === id) ?? null);
    },
    async getCheckoutByProviderId(provider, providerCheckoutId) {
      return copy(
        state.checkouts.find(
          (c) => c.provider === provider && c.provider_checkout_id === providerCheckoutId,
        ) ?? null,
      );
    },
    async findOpenCheckout({ businessId, now, plan = null, currency = null, quantity = null }) {
      return copy(
        [...state.checkouts]
          .reverse()
          .find(
            (c) =>
              c.business_id === businessId &&
              c.status === "open" &&
              (!c.expires_at || c.expires_at > now) &&
              (plan === null || c.plan === plan) &&
              (currency === null || c.currency === currency) &&
              (quantity === null || c.quantity === quantity),
          ) ?? null,
      );
    },
    async closeCheckout(id, status) {
      const row = state.checkouts.find((c) => c.id === id && c.status === "open");
      if (!row) return null;
      row.status = status;
      return row;
    },
    async abandonOtherOpenCheckouts(businessId, keepId) {
      const moved = state.checkouts.filter(
        (c) => c.business_id === businessId && c.status === "open" && c.id !== keepId,
      );
      for (const row of moved) row.status = "abandoned";
      return moved;
    },
    async expireStaleCheckouts(now) {
      const moved = state.checkouts.filter(
        (c) => c.status === "open" && c.expires_at && c.expires_at <= now,
      );
      for (const row of moved) row.status = "expired";
      return moved;
    },
    async getSubscription(id) {
      return copy(state.subscriptions.find((s) => s.id === id) ?? null);
    },
    async getSubscriptionByProviderId(provider, providerSubscriptionId) {
      return copy(
        state.subscriptions.find(
          (s) => s.provider === provider && s.provider_subscription_id === providerSubscriptionId,
        ) ?? null,
      );
    },
    async activeSubscription(businessId) {
      return copy(
        [...state.subscriptions]
          .reverse()
          .find((s) => s.business_id === businessId && OPEN.has(s.status)) ?? null,
      );
    },
    async latestSubscription(businessId) {
      return copy(
        [...state.subscriptions]
          .filter((s) => s.business_id === businessId)
          .sort((a, b) => b.updated_at - a.updated_at)[0] ?? null,
      );
    },
    async insertSubscription(input) {
      const now = new Date();
      const row = {
        id: input.id,
        business_id: input.businessId,
        provider: input.provider,
        provider_subscription_id: input.providerSubscriptionId,
        checkout_id: input.checkoutId,
        plan: input.plan,
        quantity: input.quantity,
        currency: input.currency,
        unit_amount_minor: input.unitAmountMinor,
        status: input.status,
        current_period_start: toDate(input.currentPeriodStart),
        current_period_end: toDate(input.currentPeriodEnd),
        cancel_at: toDate(input.cancelAt),
        canceled_at: null,
        metadata: input.metadata ?? {},
        created_at: now,
        updated_at: now,
      };
      state.subscriptions.push(row);
      return row;
    },
    async updateSubscription(id, patch) {
      const row = state.subscriptions.find((s) => s.id === id);
      if (!row) return null;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (
          ["current_period_start", "current_period_end", "cancel_at", "canceled_at"].includes(key)
        )
          row[key] = toDate(value);
        else row[key] = value;
      }
      return copy(touch(row));
    },
    async cancelOtherOpenSubscriptions(businessId, keepId, now) {
      const moved = state.subscriptions.filter(
        (s) => s.business_id === businessId && s.id !== keepId && OPEN.has(s.status),
      );
      for (const row of moved) touch(Object.assign(row, { status: "canceled", canceled_at: now }));
      return moved;
    },
    async listSubscriptions({ status = null, limit = 200 } = {}) {
      return state.subscriptions
        .filter((s) => status === null || s.status === status)
        .slice(0, limit)
        .map((s) => {
          const b = business(s.business_id) ?? {};
          return {
            ...s,
            business_name: b.name ?? "",
            business_slug: b.slug ?? "",
            billing_status: b.billing_status ?? "none",
            trial_status: b.trial_status ?? "none",
          };
        });
    },
    async listForReconcile() {
      return state.subscriptions
        .filter((s) => s.provider !== "manual" && OPEN.has(s.status))
        .map(copy);
    },
    async listCanceledPastEnd(now) {
      return state.subscriptions
        .filter((s) => {
          const b = business(s.business_id);
          const end = s.cancel_at ?? s.current_period_end ?? s.canceled_at ?? s.updated_at;
          return s.status === "canceled" && b?.billing_status === "canceled" && end && end <= now;
        })
        .map(copy);
    },
    async insertProviderEvent({ id, provider, providerEventId, eventType, liveMode, payload }) {
      if (
        state.providerEvents.some(
          (e) => e.provider === provider && e.provider_event_id === providerEventId,
        )
      )
        return null;
      const row = {
        id,
        provider,
        provider_event_id: providerEventId,
        event_type: eventType,
        business_id: null,
        subscription_id: null,
        live_mode: liveMode,
        payload,
        received_at: new Date(),
        processed_at: null,
        status: "received",
        error: null,
      };
      state.providerEvents.push(row);
      return row;
    },
    async getProviderEvent(provider, providerEventId) {
      return (
        state.providerEvents.find(
          (e) => e.provider === provider && e.provider_event_id === providerEventId,
        ) ?? null
      );
    },
    async reclaimFailedProviderEvent(id) {
      const row = state.providerEvents.find((e) => e.id === id && e.status === "failed");
      if (!row) return null;
      Object.assign(row, { status: "received", error: null });
      return row;
    },
    async finishProviderEvent(
      id,
      { status, error = null, businessId = null, subscriptionId = null },
    ) {
      const row = state.providerEvents.find((e) => e.id === id);
      if (row)
        Object.assign(row, {
          status,
          error,
          business_id: businessId ?? row.business_id,
          subscription_id: subscriptionId ?? row.subscription_id,
          processed_at: new Date(),
        });
    },
    async listProviderEvents({ businessId = null, limit = 100 } = {}) {
      return state.providerEvents
        .filter((e) => businessId === null || e.business_id === businessId)
        .slice(-limit)
        .reverse();
    },
    async activateBusiness({ businessId, plan, currency }) {
      const row = business(businessId);
      if (!row) return null;
      Object.assign(row, {
        plan,
        billing_status: "active",
        billing_currency: currency,
        trial_status: row.trial_status === "none" ? "none" : "converted",
        locked_at: null,
        purge_after: null,
      });
      return row;
    },
    async setBillingStatus({ businessId, status }) {
      const row = business(businessId);
      if (!row) return null;
      Object.assign(row, {
        billing_status: status,
        locked_at: null,
        purge_after: status === "active" || status === "past_due" ? null : row.purge_after,
      });
      return row;
    },
    async lockBusiness({ businessId, now, purgeAfter }) {
      const row = business(businessId);
      if (!row || !["active", "past_due", "canceled", "trialing"].includes(row.billing_status))
        return null;
      Object.assign(row, { billing_status: "locked", locked_at: now, purge_after: purgeAfter });
      return row;
    },
    async setPlan({ businessId, plan }) {
      const row = business(businessId);
      if (!row) return null;
      row.plan = plan;
      return row;
    },
    async listPaymentEvents(businessId, limit = 60) {
      return state.paymentEvents
        .filter((e) => e.business_id === businessId)
        .slice(-limit)
        .reverse();
    },
  };
  return repo;
}

/**
 * A provider double shaped like the Recurrente adapter: it signs nothing (the
 * `x-fixture-signature` header decides verification), parses payloads with the real
 * parser, and answers subscription reads from programmable snapshots.
 * @param {{ catalog?: ReturnType<typeof fixtureCatalog>, now?: () => Date, liveMode?: boolean }} [options]
 * @returns {any} shaped like the Recurrente adapter plus `calls`, `snapshots`, `program` and `failNext`
 */
export function createFakeProvider({
  catalog = fixtureCatalog(),
  now = () => new Date(),
  liveMode = false,
} = {}) {
  /** @type {Map<string, any>} */
  const snapshots = new Map();
  /** @type {Array<{ method: string, args: any[] }>} */
  const calls = [];
  let checkoutSeq = 0;
  const amount = (plan, currency) =>
    Math.round(Number((currency === "GTQ" ? catalog.gtq : catalog.usd)[plan]) * 100);
  const provider = {
    name: "recurrente",
    liveMode,
    calls,
    snapshots,
    /** Programs the read of a subscription from a GET /subscriptions/{id} fixture. */
    program(name, ids) {
      const snap = subscriptionSnapshot(loadFixture(name, ids), { catalog, now: now() });
      snapshots.set(snap.providerSubscriptionId, snap);
      return snap;
    },
    failNext: /** @type {Error | null} */ (null),
    async testConnection() {
      calls.push({ method: "testConnection", args: [] });
      return { environment: "sandbox", sandboxId: "sbx_fake" };
    },
    async createProduct(input) {
      calls.push({ method: "createProduct", args: [input] });
      return {
        productId: `prod_${input.plan.toLowerCase()}_${input.currency.toLowerCase()}`,
        priceId: `price_${input.plan.toLowerCase()}_${input.currency.toLowerCase()}`,
      };
    },
    async createCustomer(input) {
      calls.push({ method: "createCustomer", args: [input] });
      return { provider: "recurrente", providerCustomerId: "cus_fixture01" };
    },
    async createCheckout(input) {
      calls.push({ method: "createCheckout", args: [input] });
      checkoutSeq += 1;
      return {
        providerCheckoutId: checkoutSeq === 1 ? "ch_fixture01" : `ch_fixture0${checkoutSeq}`,
        url: `https://app.recurrente.com/checkout-session/ch_fixture0${checkoutSeq}`,
        expiresAt: new Date(now().getTime() + 86_400_000).toISOString(),
        unitAmountMinor: amount(input.plan, input.currency),
      };
    },
    async fetchCheckout(id) {
      calls.push({ method: "fetchCheckout", args: [id] });
      return { id, status: "unpaid", subscriptionId: null, raw: {} };
    },
    async verifyWebhook({ headers }) {
      return headers["x-fixture-signature"] !== "invalid";
    },
    parseEvent(rawBody) {
      return parseRecurrenteEvent(JSON.parse(rawBody), { defaultLiveMode: liveMode, now: now() });
    },
    async fetchSubscription(id) {
      calls.push({ method: "fetchSubscription", args: [id] });
      if (provider.failNext) {
        const error = provider.failNext;
        provider.failNext = null;
        throw error;
      }
      const snap = snapshots.get(id);
      if (!snap) throw new Error(`fake provider: unknown subscription ${id}`);
      return structuredClone(snap);
    },
    async changeSubscription(id, input) {
      calls.push({ method: "changeSubscription", args: [id, input] });
      if (provider.failNext) {
        const error = provider.failNext;
        provider.failNext = null;
        throw error;
      }
      const snap = snapshots.get(id);
      if (!snap) throw new Error(`fake provider: unknown subscription ${id}`);
      if (input.mode === "now_and_charge") {
        if (input.quantity !== undefined) snap.quantity = input.quantity;
        if (input.plan) {
          snap.plan = input.plan;
          snap.unitAmountMinor = amount(input.plan, snap.currency);
        }
      }
      return structuredClone(snap);
    },
    async cancel(id, { atPeriodEnd }) {
      calls.push({ method: "cancel", args: [id, { atPeriodEnd }] });
      const snap = snapshots.get(id);
      if (!snap) throw new Error(`fake provider: unknown subscription ${id}`);
      if (atPeriodEnd) {
        snap.cancelAt = snap.currentPeriodEnd;
        snap.metadata.provider_cancel_at_period_end = "true";
      } else {
        snap.status = "canceled";
        snap.cancelAt = now().toISOString();
        snap.metadata.provider_ended_at = now().toISOString();
        snap.metadata.provider_cancellation_reason = "cancellation_requested";
      }
      return structuredClone(snap);
    },
  };
  return provider;
}
