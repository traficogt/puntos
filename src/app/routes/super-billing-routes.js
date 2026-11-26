// Super console billing operations (design section 7.4, wave 2): subscription and
// webhook listings for incident work, the Recurrente catalog sync that creates the
// products and stores their price ids, and the immediate cancel that only the platform
// owner may run. Audited like the wave-1 trial actions (audit_logs + security_events).
import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { requireSuperAdmin } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { validateQuery } from "../../utils/schemas.js";
import { getRequestIp } from "../../utils/request-ip.js";
import { logger } from "../../utils/logger.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { BillingSubscriptionRepo } from "../repositories/billing-subscription-repository.js";
import { subscriptionService, subscriptionView } from "../services/billing/subscription-service.js";
import { RECURRENTE_EVENT_MAP } from "../services/billing/recurrente-provider.js";
import { STRIPE_EVENT_MAP } from "../services/billing/stripe-provider.js";
import { planDisplayName } from "../services/trial-entitlement.js";
import { withDbClientContext } from "../database.js";
import { logSuperAudit } from "./super-support.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {Promise<Response | void>} HandlerResult */
/**
 * @template Q
 * @typedef {import("./_request-types.js").WithValidatedQuery<Q>} WithValidatedQuery
 */
/** @typedef {import("../services/billing/subscription-service.js").SubscriptionService} SubscriptionService */

export const SuperBillingSubscriptionsQuerySchema = z.object({
  status: z.enum(["active", "past_due", "paused", "canceled"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const SuperBillingEventsQuerySchema = z.object({
  business_id: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.guid().optional()),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const SuperBillingCancelSchema = z
  .object({ at_period_end: z.boolean().default(false), note: z.string().max(500).optional() })
  .strict();
export const SuperBillingCatalogSyncSchema = z
  .object({
    provider: z.enum(["recurrente", "stripe"]).default("recurrente"),
    force: z.boolean().default(false),
  })
  .strict();

/** @typedef {z.infer<typeof SuperBillingSubscriptionsQuerySchema>} SubscriptionsQuery */
/** @typedef {z.infer<typeof SuperBillingEventsQuerySchema>} EventsQuery */

/** @param {unknown} payload */
function payloadSummary(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const body = /** @type {Record<string, any>} */ (payload);
  const stripe = body.data?.object;
  const source = stripe && typeof stripe === "object" ? stripe : body;
  const seconds = Number(body.created);
  const when = stripe ? new Date(seconds * 1000) : new Date(body.created_at);
  const amount = stripe
    ? source.object === "invoice"
      ? body.type === "invoice.payment_failed"
        ? source.amount_due
        : source.amount_paid
      : body.type === "charge.refunded"
        ? source.amount_refunded
        : (source.amount_total ?? source.amount)
    : source.amount_in_cents;
  const subscription =
    source.object === "subscription"
      ? source.id
      : (source.parent?.subscription_details?.subscription ?? source.subscription);
  return {
    id: typeof source.id === "string" ? source.id : null,
    status: typeof source.status === "string" ? source.status : null,
    occurred_at: Number.isFinite(when.getTime()) ? when.toISOString() : null,
    amount_in_cents: typeof amount === "number" ? amount : null,
    currency: typeof source.currency === "string" ? source.currency.toUpperCase() : null,
    checkout_id: source.object === "checkout.session" ? source.id : (source.checkout?.id ?? null),
    subscription_id: typeof subscription === "string" ? subscription : (subscription?.id ?? null),
    tax_invoice_url:
      typeof source.hosted_invoice_url === "string"
        ? source.hosted_invoice_url
        : typeof source.tax_invoice_url === "string"
          ? source.tax_invoice_url
          : null,
  };
}

/**
 * @param {{
 *   service?: () => Pick<SubscriptionService, "superCancel" | "syncCatalog" | "isConfigured">,
 *   repo?: Pick<typeof BillingSubscriptionRepo, "listSubscriptions" | "listProviderEvents">,
 *   superAuth?: import("express").RequestHandler,
 *   getBusiness?: (id: string) => Promise<import("../repositories/business-repository.js").BusinessRow | null>,
 *   platform?: <T>(fn: () => Promise<T>) => Promise<T>
 * }} [deps]
 */
export function createSuperBillingRoutes({
  service = subscriptionService,
  repo = BillingSubscriptionRepo,
  superAuth = requireSuperAdmin,
  getBusiness = (id) => BusinessRepo.getById(id),
  platform = (fn) => withDbClientContext({ platformAdmin: true, tenantId: null }, fn),
} = {}) {
  const router = Router();

  /**
   * @param {{ req: Request, action: string, businessId: string | null, meta?: Record<string, unknown> }} entry
   */
  async function audit({ req, action, businessId, meta = {} }) {
    const superAdminEmail = req.superAdmin?.email ?? null;
    if (businessId) await logSuperAudit({ action, businessId, req, superAdminEmail, meta });
    else logger.info({ action, superAdminEmail, ...meta }, "Platform billing action");
    await SecurityEventRepo.log({
      event_type: action,
      severity: "LOW",
      business_id: businessId,
      route: req.originalUrl ?? null,
      method: req.method,
      ip: getRequestIp(req) || null,
      actor_type: "SUPER_ADMIN",
      actor_id: null,
      meta: { super_admin_email: superAdminEmail, ...meta },
    }).catch(() => {});
  }

  router.get(
    "/super/billing/subscriptions",
    superAuth,
    validateQuery(SuperBillingSubscriptionsQuerySchema),
    asyncRoute(
      /** @param {Request & WithValidatedQuery<SubscriptionsQuery>} req @param {Response} res */
      async (req, res) => {
        const { status, limit } = req.validatedQuery;
        const rows = await platform(() =>
          repo.listSubscriptions({ status: status ?? null, limit }),
        );
        res.json({
          ok: true,
          provider_configured: service().isConfigured(),
          subscriptions: rows.map((row) => ({
            ...subscriptionView(row),
            business_id: row.business_id,
            business_name: row.business_name,
            slug: row.business_slug,
            business: {
              id: row.business_id,
              name: row.business_name,
              slug: row.business_slug,
              billing_status: row.billing_status,
              trial_status: row.trial_status,
            },
            provider_subscription_id: row.provider_subscription_id,
            created_at: new Date(row.created_at).toISOString(),
            updated_at: new Date(row.updated_at).toISOString(),
          })),
        });
      },
    ),
  );

  router.get(
    "/super/billing/events",
    superAuth,
    validateQuery(SuperBillingEventsQuerySchema),
    asyncRoute(
      /** @param {Request & WithValidatedQuery<EventsQuery>} req @param {Response} res */
      async (req, res) => {
        const { business_id: businessId, limit } = req.validatedQuery;
        const rows = await platform(() =>
          repo.listProviderEvents({ businessId: businessId ?? null, limit }),
        );
        res.json({
          ok: true,
          events: rows.map((row) => {
            const summary = payloadSummary(row.payload);
            /** @type {Readonly<Record<string, string>>} */
            const types = row.provider === "stripe" ? STRIPE_EVENT_MAP : RECURRENTE_EVENT_MAP;
            return {
              type: Object.hasOwn(types, row.event_type) ? types[row.event_type] : row.event_type,
              occurred_at: summary.occurred_at ?? new Date(row.received_at).toISOString(),
              amount_minor: summary.amount_in_cents ?? null,
              currency: summary.currency ?? null,
              tax_invoice_url: summary.tax_invoice_url ?? null,
              id: row.id,
              provider: row.provider,
              provider_event_id: row.provider_event_id,
              event_type: row.event_type,
              status: row.status,
              error: row.error,
              live_mode: row.live_mode,
              business_id: row.business_id,
              subscription_id: row.subscription_id,
              received_at: new Date(row.received_at).toISOString(),
              processed_at: row.processed_at ? new Date(row.processed_at).toISOString() : null,
              summary,
            };
          }),
        });
      },
    ),
  );

  router.post(
    "/super/billing/catalog/sync",
    csrfProtect,
    superAuth,
    asyncRoute(
      /** @param {Request} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const parsed = SuperBillingCatalogSyncSchema.safeParse(req.body ?? {});
        if (!parsed.success)
          return res.status(400).json({ error: "Payload inválido", code: "VALIDATION_ERROR" });
        const out = await service().syncCatalog(parsed.data);
        await audit({
          req,
          action: "super.billing_catalog.sync",
          businessId: null,
          meta: {
            provider: out.provider,
            created: out.created.map((c) => `${c.currency}:${c.plan}`),
            kept: out.kept.length,
            live_mode: out.live_mode,
            force: parsed.data.force,
          },
        });
        res.json({ ok: true, ...out });
      },
    ),
  );

  router.post(
    "/super/businesses/:businessId/billing/cancel",
    csrfProtect,
    superAuth,
    asyncRoute(
      /** @param {Request} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const parsed = SuperBillingCancelSchema.safeParse(req.body ?? {});
        if (!parsed.success)
          return res.status(400).json({ error: "Payload inválido", code: "VALIDATION_ERROR" });
        const businessId = String(req.params.businessId || "");
        const business = await getBusiness(businessId);
        if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
        const out = await service().superCancel({
          businessId,
          atPeriodEnd: parsed.data.at_period_end,
          by: req.superAdmin?.email ?? null,
        });
        await audit({
          req,
          action: "super.billing.cancel",
          businessId,
          meta: {
            at_period_end: parsed.data.at_period_end,
            ended: out.ended,
            note: parsed.data.note ?? null,
            previous_billing_status: business.billing_status,
            plan: business.plan,
          },
        });
        const updated = await getBusiness(businessId);
        res.json({
          ok: true,
          business: updated
            ? {
                id: updated.id,
                name: updated.name,
                plan: updated.plan,
                plan_name: planDisplayName(updated.plan),
                billing_status: updated.billing_status,
                trial_status: updated.trial_status,
                purge_after: updated.purge_after
                  ? new Date(updated.purge_after).toISOString()
                  : null,
              }
            : null,
          subscription: out.subscription,
          ended: out.ended,
        });
      },
    ),
  );

  return router;
}

export const superBillingRoutes = createSuperBillingRoutes();
