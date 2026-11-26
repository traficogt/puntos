// Rows of the provider-agnostic billing tables of migration 2026-11-26-c
// (billing_customers, billing_checkouts, billing_subscriptions, billing_provider_events)
// plus the `businesses` access-state transitions the billing adapter drives. The owner
// reads its rows through tenant RLS; every write needs the platform context, which
// subscription-service.js supplies.
import { dbQuery } from "../database.js";
import { one, many, exec } from "./base.js";

/** @typedef {import("./trial-repository.js").BillingSubscriptionRow} BillingSubscriptionRow */
/** @typedef {import("./business-repository.js").BusinessRow} BusinessRow */
/**
 * Row of `billing_customers`.
 * @typedef {{
 *   business_id: string,
 *   provider: string,
 *   provider_customer_id: string,
 *   email: string,
 *   tax_id: string | null,
 *   tax_name: string | null,
 *   created_at: Date
 * }} BillingCustomerRow
 */
/**
 * Row of `billing_checkouts`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   provider: string,
 *   provider_checkout_id: string,
 *   plan: string,
 *   quantity: number,
 *   currency: string,
 *   unit_amount_minor: number,
 *   status: "open" | "paid" | "expired" | "abandoned",
 *   checkout_url: string,
 *   expires_at: Date | null,
 *   created_at: Date
 * }} BillingCheckoutRow
 */
/**
 * Row of `billing_provider_events`.
 * @typedef {{
 *   id: string,
 *   provider: string,
 *   provider_event_id: string,
 *   event_type: string,
 *   business_id: string | null,
 *   subscription_id: string | null,
 *   live_mode: boolean,
 *   payload: unknown,
 *   received_at: Date,
 *   processed_at: Date | null,
 *   status: "received" | "processed" | "ignored" | "failed",
 *   error: string | null
 * }} BillingProviderEventRow
 */
/** A subscription row joined with the business it belongs to (super listings). */
/** @typedef {BillingSubscriptionRow & { business_name: string, business_slug: string, billing_status: string, trial_status: string }} BillingSubscriptionListingRow */
/**
 * Columns `updateSubscription` may set.
 * @typedef {{
 *   plan?: string,
 *   quantity?: number,
 *   currency?: string,
 *   unit_amount_minor?: number,
 *   status?: string,
 *   current_period_start?: Date | string | null,
 *   current_period_end?: Date | string | null,
 *   cancel_at?: Date | string | null,
 *   canceled_at?: Date | string | null,
 *   checkout_id?: string | null,
 *   metadata?: Record<string, unknown>
 * }} SubscriptionPatch
 */

const OPEN_STATUSES = "('active','past_due','paused')";
const SUBSCRIPTION_COLUMNS = new Set([
  "plan",
  "quantity",
  "currency",
  "unit_amount_minor",
  "status",
  "current_period_start",
  "current_period_end",
  "cancel_at",
  "canceled_at",
  "checkout_id",
  "metadata",
]);

export const BillingSubscriptionRepo = {
  // --- customers -------------------------------------------------------------------
  /**
   * Resolves to `BillingCustomerRow | null`.
   * @param {string} businessId
   * @param {string} provider
   */
  async getCustomer(businessId, provider) {
    return one(`SELECT * FROM billing_customers WHERE business_id=$1 AND provider=$2`, [
      businessId,
      provider,
    ]);
  },
  /**
   * Reverse lookup for webhook payloads that only name the provider's customer (Stripe
   * charges and refunds). Resolves to `BillingCustomerRow | null`.
   * @param {string} provider
   * @param {string} providerCustomerId
   */
  async getCustomerByProviderId(provider, providerCustomerId) {
    return one(`SELECT * FROM billing_customers WHERE provider=$1 AND provider_customer_id=$2`, [
      provider,
      providerCustomerId,
    ]);
  },
  /**
   * Resolves to `BillingCustomerRow`.
   * @param {{ businessId: string, provider: string, providerCustomerId: string, email: string, taxId?: string | null, taxName?: string | null }} input
   */
  async upsertCustomer({
    businessId,
    provider,
    providerCustomerId,
    email,
    taxId = null,
    taxName = null,
  }) {
    return one(
      `INSERT INTO billing_customers(business_id,provider,provider_customer_id,email,tax_id,tax_name)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (business_id, provider) DO UPDATE
         SET provider_customer_id=EXCLUDED.provider_customer_id, email=EXCLUDED.email,
             tax_id=COALESCE(EXCLUDED.tax_id, billing_customers.tax_id),
             tax_name=COALESCE(EXCLUDED.tax_name, billing_customers.tax_name)
       RETURNING *`,
      [businessId, provider, providerCustomerId, email, taxId, taxName],
    );
  },

  // --- checkouts -------------------------------------------------------------------
  /**
   * Resolves to `BillingCheckoutRow`.
   * @param {{ id: string, businessId: string, provider: string, providerCheckoutId: string, plan: string, quantity: number,
   *   currency: string, unitAmountMinor: number, checkoutUrl: string, expiresAt: Date | string | null }} input
   */
  async insertCheckout({
    id,
    businessId,
    provider,
    providerCheckoutId,
    plan,
    quantity,
    currency,
    unitAmountMinor,
    checkoutUrl,
    expiresAt,
  }) {
    return one(
      `INSERT INTO billing_checkouts(id,business_id,provider,provider_checkout_id,plan,quantity,currency,
         unit_amount_minor,status,checkout_url,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10) RETURNING *`,
      [
        id,
        businessId,
        provider,
        providerCheckoutId,
        plan,
        quantity,
        currency,
        unitAmountMinor,
        checkoutUrl,
        expiresAt,
      ],
    );
  },
  /** Resolves to `BillingCheckoutRow | null`. @param {string} id */
  async getCheckout(id) {
    return one(`SELECT * FROM billing_checkouts WHERE id=$1`, [id]);
  },
  /**
   * Resolves to `BillingCheckoutRow | null`.
   * @param {string} provider
   * @param {string} providerCheckoutId
   */
  async getCheckoutByProviderId(provider, providerCheckoutId) {
    return one(`SELECT * FROM billing_checkouts WHERE provider=$1 AND provider_checkout_id=$2`, [
      provider,
      providerCheckoutId,
    ]);
  },
  /**
   * The newest still-open checkout of a business, optionally for one plan/currency.
   * Resolves to `BillingCheckoutRow | null`.
   * @param {{ businessId: string, now: Date, plan?: string | null, currency?: string | null, quantity?: number | null }} input
   */
  async findOpenCheckout({ businessId, now, plan = null, currency = null, quantity = null }) {
    return one(
      `SELECT * FROM billing_checkouts
       WHERE business_id=$1 AND status='open' AND (expires_at IS NULL OR expires_at > $2)
         AND ($3::text IS NULL OR plan=$3) AND ($4::text IS NULL OR currency=$4)
         AND ($5::int IS NULL OR quantity=$5)
       ORDER BY created_at DESC LIMIT 1`,
      [businessId, now, plan, currency, quantity],
    );
  },
  /**
   * Moves an open checkout to a terminal status; resolves to the row when it moved.
   * @param {string} id
   * @param {"paid" | "expired" | "abandoned"} status
   */
  async closeCheckout(id, status) {
    return one(`UPDATE billing_checkouts SET status=$2 WHERE id=$1 AND status='open' RETURNING *`, [
      id,
      status,
    ]);
  },
  /**
   * Abandons every other open checkout of a business once one of them paid.
   * Resolves to `BillingCheckoutRow[]` (the rows that moved).
   * @param {string} businessId
   * @param {string | null} keepId
   */
  async abandonOtherOpenCheckouts(businessId, keepId) {
    return many(
      `UPDATE billing_checkouts SET status='abandoned'
       WHERE business_id=$1 AND status='open' AND ($2::uuid IS NULL OR id <> $2) RETURNING *`,
      [businessId, keepId],
    );
  },
  /**
   * Expires open checkouts past their expiry. Resolves to `BillingCheckoutRow[]`.
   * @param {Date} now
   */
  async expireStaleCheckouts(now) {
    return many(
      `UPDATE billing_checkouts SET status='expired'
       WHERE status='open' AND expires_at IS NOT NULL AND expires_at <= $1 RETURNING *`,
      [now],
    );
  },

  // --- subscriptions ---------------------------------------------------------------
  /** Resolves to `BillingSubscriptionRow | null`. @param {string} id */
  async getSubscription(id) {
    return one(`SELECT * FROM billing_subscriptions WHERE id=$1`, [id]);
  },
  /**
   * Resolves to `BillingSubscriptionRow | null`.
   * @param {string} provider
   * @param {string} providerSubscriptionId
   */
  async getSubscriptionByProviderId(provider, providerSubscriptionId) {
    return one(
      `SELECT * FROM billing_subscriptions WHERE provider=$1 AND provider_subscription_id=$2`,
      [provider, providerSubscriptionId],
    );
  },
  /**
   * The business's open subscription (active, past_due or paused), if any.
   * Resolves to `BillingSubscriptionRow | null`.
   * @param {string} businessId
   */
  async activeSubscription(businessId) {
    return one(
      `SELECT * FROM billing_subscriptions WHERE business_id=$1 AND status IN ${OPEN_STATUSES}
       ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
  },
  /**
   * The newest subscription of a business in any status. Resolves to `BillingSubscriptionRow | null`.
   * @param {string} businessId
   */
  async latestSubscription(businessId) {
    return one(
      `SELECT * FROM billing_subscriptions WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 1`,
      [businessId],
    );
  },
  /**
   * Resolves to `BillingSubscriptionRow`.
   * @param {{ id: string, businessId: string, provider: string, providerSubscriptionId: string, checkoutId: string | null,
   *   plan: string, quantity: number, currency: string, unitAmountMinor: number, status: string,
   *   currentPeriodStart: Date | string | null, currentPeriodEnd: Date | string | null, cancelAt: Date | string | null,
   *   metadata: Record<string, unknown> }} input
   */
  async insertSubscription({
    id,
    businessId,
    provider,
    providerSubscriptionId,
    checkoutId,
    plan,
    quantity,
    currency,
    unitAmountMinor,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAt,
    metadata,
  }) {
    return one(
      `INSERT INTO billing_subscriptions(id,business_id,provider,provider_subscription_id,checkout_id,plan,quantity,
         currency,unit_amount_minor,status,current_period_start,current_period_end,cancel_at,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        id,
        businessId,
        provider,
        providerSubscriptionId,
        checkoutId,
        plan,
        quantity,
        currency,
        unitAmountMinor,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAt,
        metadata,
      ],
    );
  },
  /**
   * Partial update of the allowed columns; `metadata` replaces the document.
   * Resolves to `BillingSubscriptionRow | null`.
   * @param {string} id
   * @param {SubscriptionPatch} patch
   */
  async updateSubscription(id, patch) {
    /** @type {string[]} */
    const sets = [];
    /** @type {unknown[]} */
    const params = [id];
    for (const [column, value] of Object.entries(patch)) {
      if (!SUBSCRIPTION_COLUMNS.has(column) || value === undefined) continue;
      params.push(value);
      sets.push(`${column}=$${params.length}`);
    }
    if (!sets.length) return this.getSubscription(id);
    return one(
      `UPDATE billing_subscriptions SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 RETURNING *`,
      params,
    );
  },
  /**
   * Closes every other open subscription of a business (a new paid one replaces a manual
   * or stale row). Resolves to `BillingSubscriptionRow[]`.
   * @param {string} businessId
   * @param {string} keepId
   * @param {Date} now
   */
  async cancelOtherOpenSubscriptions(businessId, keepId, now) {
    return many(
      `UPDATE billing_subscriptions SET status='canceled', canceled_at=$3, updated_at=now()
       WHERE business_id=$1 AND id <> $2 AND status IN ${OPEN_STATUSES} RETURNING *`,
      [businessId, keepId, now],
    );
  },
  /**
   * Super listing. Resolves to `BillingSubscriptionListingRow[]`.
   * @param {{ status?: string | null, limit?: number }} [options]
   */
  async listSubscriptions({ status = null, limit = 200 } = {}) {
    return many(
      `SELECT s.*, b.name AS business_name, b.slug AS business_slug, b.billing_status, b.trial_status
       FROM billing_subscriptions s JOIN businesses b ON b.id=s.business_id
       WHERE ($1::text IS NULL OR s.status=$1)
       ORDER BY s.updated_at DESC LIMIT $2`,
      [status, Math.min(500, Math.max(1, Number(limit) || 200))],
    );
  },
  /**
   * Provider-backed open subscriptions the daily reconcile converges.
   * Resolves to `BillingSubscriptionRow[]`.
   */
  async listForReconcile() {
    return many(
      `SELECT * FROM billing_subscriptions WHERE provider <> 'manual' AND status IN ${OPEN_STATUSES}
       ORDER BY updated_at ASC LIMIT 1000`,
    );
  },
  /**
   * Canceled subscriptions whose paid period has ended while the business still has
   * access (billing_status 'canceled'). Resolves to `BillingSubscriptionRow[]`.
   * @param {Date} now
   */
  async listCanceledPastEnd(now) {
    return many(
      `SELECT DISTINCT ON (s.business_id) s.* FROM billing_subscriptions s
       JOIN businesses b ON b.id=s.business_id
       WHERE s.status='canceled' AND b.billing_status='canceled'
         AND COALESCE(s.cancel_at, s.current_period_end, s.canceled_at, s.updated_at) <= $1
       ORDER BY s.business_id, s.updated_at DESC`,
      [now],
    );
  },

  // --- provider events ---------------------------------------------------------------
  /**
   * Records a webhook delivery once per provider event id. Resolves to the new row, or
   * `null` when the id was already recorded (duplicate delivery).
   * @param {{ id: string, provider: string, providerEventId: string, eventType: string, liveMode: boolean, payload: unknown }} input
   */
  async insertProviderEvent({ id, provider, providerEventId, eventType, liveMode, payload }) {
    return one(
      `INSERT INTO billing_provider_events(id,provider,provider_event_id,event_type,live_mode,payload)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING *`,
      [id, provider, providerEventId, eventType, liveMode, JSON.stringify(payload ?? null)],
    );
  },
  /**
   * Resolves to `BillingProviderEventRow | null`.
   * @param {string} provider
   * @param {string} providerEventId
   */
  async getProviderEvent(provider, providerEventId) {
    return one(`SELECT * FROM billing_provider_events WHERE provider=$1 AND provider_event_id=$2`, [
      provider,
      providerEventId,
    ]);
  },
  /** Called inside the transaction that also applies and finishes the delivery.
   * @param {string} provider @param {string} eventId */
  async lockProviderEvent(provider, eventId) {
    return one(
      "SELECT * FROM billing_provider_events WHERE provider=$1 AND provider_event_id=$2 FOR UPDATE",
      [provider, eventId],
    );
  },

  /** @param {string} businessId */
  async lockBusinessForBilling(businessId) {
    await one("SELECT id FROM businesses WHERE id=$1 FOR UPDATE", [businessId]);
  },

  /** A later online or manual contract may already have ended by the time the webhook arrives.
   * @param {string} checkoutId */
  async hasContractAfterCheckout(checkoutId) {
    return Boolean(
      await one(
        `SELECT 1 FROM billing_checkouts c JOIN billing_subscriptions s
      ON s.business_id=c.business_id AND s.created_at >= c.created_at WHERE c.id=$1 LIMIT 1`,
        [checkoutId],
      ),
    );
  },

  /** @param {string} businessId @param {string} invoiceId */
  async hasPaidInvoice(businessId, invoiceId) {
    return Boolean(
      await one(
        `SELECT 1 FROM billing_events WHERE business_id=$1 AND event_type='payment.succeeded'
      AND metadata->>'invoice_id'=$2 LIMIT 1`,
        [businessId, invoiceId],
      ),
    );
  },
  /**
   * @param {string} id
   * @param {{ status: "processed" | "ignored" | "failed", payload?: unknown, error?: string | null, businessId?: string | null, subscriptionId?: string | null }} outcome
   */
  async finishProviderEvent(
    id,
    { status, error = null, businessId = null, subscriptionId = null, payload },
  ) {
    await exec(
      `UPDATE billing_provider_events SET status=$2, error=$3, business_id=COALESCE($4, business_id),
         subscription_id=COALESCE($5, subscription_id), payload=COALESCE($6::jsonb, payload), processed_at=now() WHERE id=$1 AND status IN ('received','failed')`,
      [
        id,
        status,
        error ? String(error).slice(0, 500) : null,
        businessId,
        subscriptionId,
        payload === undefined ? null : JSON.stringify(payload),
      ],
    );
  },
  /**
   * Super listing of webhook deliveries. Resolves to `BillingProviderEventRow[]`.
   * @param {{ businessId?: string | null, limit?: number }} [options]
   */
  async listProviderEvents({ businessId = null, limit = 100 } = {}) {
    return many(
      `SELECT * FROM billing_provider_events WHERE ($1::uuid IS NULL OR business_id=$1)
       ORDER BY received_at DESC LIMIT $2`,
      [businessId, Math.min(500, Math.max(1, Number(limit) || 100))],
    );
  },

  // --- business access state -----------------------------------------------------------
  /**
   * First successful payment (design section 4.4): plan becomes the entitlement, access
   * state active, the trial converted, the retention clock cleared. Resolves to `BusinessRow | null`.
   * @param {{ businessId: string, plan: string, currency: string }} input
   */
  async activateBusiness({ businessId, plan, currency }) {
    return one(
      `UPDATE businesses SET plan=$2, billing_status='active', billing_currency=$3,
         trial_status = CASE WHEN trial_status='none' THEN 'none' ELSE 'converted' END,
         locked_at=NULL, purge_after=NULL, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [businessId, plan, currency],
    );
  },
  /**
   * Access-state change without touching the plan (past_due, canceled, back to active).
   * Resolves to `BusinessRow | null`.
   * @param {{ businessId: string, status: "active" | "past_due" | "canceled" }} input
   */
  async setBillingStatus({ businessId, status }) {
    return one(
      `UPDATE businesses SET billing_status=$2, locked_at=NULL,
         purge_after = CASE WHEN $2 IN ('active','past_due') THEN NULL ELSE purge_after END,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [businessId, status],
    );
  },
  /**
   * Billing lock (design sections 4.5 and 4.6): the same read-only state as an expired
   * trial. `purgeAfter` is null for a payment-grace lock (a later payment unlocks) and
   * set when the subscription ended for good. Resolves to `BusinessRow | null`.
   * @param {{ businessId: string, now: Date, purgeAfter: Date | null }} input
   */
  async lockBusiness({ businessId, now, purgeAfter }) {
    return one(
      `UPDATE businesses SET billing_status='locked', locked_at=$2, purge_after=$3, updated_at=now()
       WHERE id=$1 AND billing_status IN ('active','past_due','canceled','trialing') RETURNING *`,
      [businessId, now, purgeAfter],
    );
  },
  /**
   * Plan change on an active subscription (upgrade now, downgrade next cycle still
   * updates the entitlement when the provider confirms). Resolves to `BusinessRow | null`.
   * @param {{ businessId: string, plan: string }} input
   */
  async setPlan({ businessId, plan }) {
    return one(`UPDATE businesses SET plan=$2, updated_at=now() WHERE id=$1 RETURNING *`, [
      businessId,
      plan,
    ]);
  },
  /**
   * Payment outcomes recorded in the tenant ledger (billing_events) for the owner's
   * invoice list. Resolves to rows ordered newest first.
   * @param {string} businessId
   * @param {number} [limit]
   * @returns {Promise<Array<{ created_at: Date, event_type: string, metadata: Record<string, unknown> }>>}
   */
  async listPaymentEvents(businessId, limit = 60) {
    const { rows } = await dbQuery(
      `SELECT created_at, event_type, metadata FROM billing_events
       WHERE business_id=$1 AND event_type IN ('payment.succeeded','payment.failed','payment.refunded')
       ORDER BY created_at DESC LIMIT $2`,
      [businessId, Math.min(200, Math.max(1, Number(limit) || 60))],
    );
    return rows;
  },
};
