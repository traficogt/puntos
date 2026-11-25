// The manual provider stands for subscriptions the platform owner activates by hand
// (bank transfer, invoice) through POST /api/super/businesses/:id/billing/manual-activate
// (wave 1). It moves no money: there is no hosted checkout, no webhook and nothing to
// fetch, so the subscription-service treats its rows as the local source of truth.
// Cancelling a manual subscription is a local state change.
import { HttpError } from "../../../utils/http-error.js";

/** @typedef {import("./provider.js").BillingProvider} BillingProvider */
/** @typedef {import("./provider.js").SubscriptionSnapshot} SubscriptionSnapshot */

/**
 * The stored row the manual provider echoes back as a snapshot. Only the columns it
 * reads are typed; the repository row satisfies it.
 * @typedef {{
 *   provider_subscription_id: string,
 *   status: string,
 *   plan: string,
 *   quantity: number,
 *   currency: string,
 *   unit_amount_minor: number,
 *   current_period_start: Date | string | null,
 *   current_period_end: Date | string | null,
 *   cancel_at: Date | string | null,
 *   metadata: Record<string, unknown>
 * }} ManualSubscriptionRow
 */

/** @param {Date | string | null | undefined} value */
const iso = (value) => (value ? new Date(value).toISOString() : null);

/** @param {string} status */
function normalizeStatus(status) {
  return status === "active" || status === "past_due" || status === "paused" ? status : "canceled";
}

/**
 * @param {ManualSubscriptionRow} row
 * @param {Partial<Pick<SubscriptionSnapshot, "status" | "quantity" | "plan" | "cancelAt">>} [patch]
 * @returns {SubscriptionSnapshot}
 */
export function manualSnapshot(row, patch = {}) {
  /** @type {Record<string, string>} */
  const metadata = {};
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (value !== null && value !== undefined && typeof value !== "object")
      metadata[key] = String(value);
  }
  return {
    providerSubscriptionId: row.provider_subscription_id,
    status: patch.status ?? normalizeStatus(row.status),
    plan: patch.plan ?? row.plan,
    quantity: patch.quantity ?? Number(row.quantity),
    currency: row.currency === "GTQ" ? "GTQ" : "USD",
    unitAmountMinor: Number(row.unit_amount_minor),
    currentPeriodStart: iso(row.current_period_start),
    currentPeriodEnd: iso(row.current_period_end),
    cancelAt: patch.cancelAt === undefined ? iso(row.cancel_at) : patch.cancelAt,
    metadata,
  };
}

/**
 * @param {{ getSubscription: (providerSubscriptionId: string) => Promise<ManualSubscriptionRow | null>, now?: () => Date }} deps
 * @returns {BillingProvider}
 */
export function createManualProvider({ getSubscription, now = () => new Date() }) {
  /** @param {string} id */
  async function load(id) {
    const row = await getSubscription(id);
    if (!row)
      throw new HttpError(404, "Suscripción manual no encontrada", "BILLING_NO_SUBSCRIPTION");
    return row;
  }
  return {
    name: "manual",
    async createCustomer({ businessId }) {
      return { provider: "manual", providerCustomerId: String(businessId) };
    },
    async createCheckout() {
      throw new HttpError(
        503,
        "La activación manual la realiza el equipo de PuntosFieles; no hay pago en línea para este proveedor.",
        "BILLING_UNAVAILABLE",
      );
    },
    async verifyWebhook() {
      return false;
    },
    parseEvent(rawBody) {
      return {
        id: `manual:${Date.now()}`,
        liveMode: false,
        occurredAt: now().toISOString(),
        metadata: {},
        raw: rawBody,
        type: "ignored",
      };
    },
    async fetchSubscription(providerSubscriptionId) {
      return manualSnapshot(await load(providerSubscriptionId));
    },
    async changeSubscription(providerSubscriptionId, input) {
      const row = await load(providerSubscriptionId);
      return manualSnapshot(row, {
        quantity: input.quantity ?? Number(row.quantity),
        plan: input.plan ?? row.plan,
      });
    },
    async cancel(providerSubscriptionId, { atPeriodEnd }) {
      const row = await load(providerSubscriptionId);
      const periodEnd = iso(row.current_period_end);
      return manualSnapshot(row, {
        status: atPeriodEnd && periodEnd ? normalizeStatus(row.status) : "canceled",
        cancelAt: atPeriodEnd && periodEnd ? periodEnd : now().toISOString(),
      });
    },
  };
}
