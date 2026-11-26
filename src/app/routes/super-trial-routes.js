import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { requireSuperAdmin } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { validateQuery } from "../../utils/schemas.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { getRequestIp } from "../../utils/request-ip.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { TrialRepo } from "../repositories/trial-repository.js";
import {
  BillingCatalogSchema,
  BillingCatalogService,
} from "../services/billing-catalog-service.js";
import { emitBillingEvent } from "../services/billing-service.js";
import { businessPaysInGtq } from "../services/billing/subscription-service.js";
import { regionTimezone } from "../services/regional-settings.js";
import { planDisplayName } from "../services/trial-entitlement.js";
import { purgeDryRun } from "../services/trial-lifecycle-service.js";
import { countTrialTransition } from "../services/trial-metrics.js";
import { trialState } from "../services/trial-state.js";
import { withDbClientContext } from "../database.js";
import { logSuperAudit, requireSupportedPlan } from "./super-support.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {Promise<Response | void>} HandlerResult */
/**
 * @template Q
 * @typedef {import("./_request-types.js").WithValidatedQuery<Q>} WithValidatedQuery
 */

export const superTrialRoutes = Router();

export const TrialExtendSchema = z
  .object({ days: z.number().int().min(1).max(90), note: z.string().max(500).optional() })
  .strict();
export const ManualActivateSchema = z
  .object({
    plan: z.string().min(3).max(40),
    currency: z.enum(["GTQ", "USD"]).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
const TrialsQuerySchema = z.object({
  status: z.enum(["all", "trialing", "expiring", "locked", "converted", "purge"]).default("all"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
/** @typedef {z.infer<typeof TrialsQuerySchema>} TrialsQuery */
/** @typedef {z.infer<typeof TrialExtendSchema>} TrialExtendInput */
/** @typedef {z.infer<typeof ManualActivateSchema>} ManualActivateInput */

const DAY_MS = 86_400_000;

/**
 * Platform-level actions are recorded twice, as the codebase does for super actions:
 * audit_logs against the business (logSuperAudit) and a LOW security event so the
 * security posture view lists trial and billing changes.
 * @param {{ req: Request, action: string, businessId: string, meta?: Record<string, unknown> }} entry
 */
async function auditPlatformAction({ req, action, businessId, meta = {} }) {
  const superAdminEmail = req.superAdmin?.email ?? null;
  await logSuperAudit({ action, businessId, req, superAdminEmail, meta });
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

/**
 * @param {import("../repositories/trial-repository.js").TrialListingRow} row
 * @param {Date} now
 */
function trialListingEntry(row, now) {
  const state = trialState(row, { now, timezone: regionTimezone(row) });
  const purgeAfter = row.purge_after ? new Date(row.purge_after) : null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    email: row.email,
    plan: row.plan,
    plan_name: planDisplayName(row.plan),
    signup_source: row.signup_source,
    trial_status: row.trial_status,
    billing_status: row.billing_status,
    status: state.status,
    days_left: state.days_left,
    phone_verified: Boolean(row.trial_phone),
    trial_started_at: state.started_at,
    trial_ends_at: state.ends_at,
    locked_at: state.locked_at,
    purge_after: state.purge_after,
    purge_candidate: Boolean(purgeAfter && purgeAfter.getTime() <= now.getTime()),
    reminders_sent: row.kinds_sent ?? [],
    customers: Number(row.customers) || 0,
    activation: {
      programa_en_marcha_at: row.programa_en_marcha_at
        ? new Date(row.programa_en_marcha_at).toISOString()
        : null,
      primer_cliente_at: row.primer_cliente_at
        ? new Date(row.primer_cliente_at).toISOString()
        : null,
      // Activation = both milestones before the trial end (design section 9).
      activated: Boolean(
        row.programa_en_marcha_at &&
        row.primer_cliente_at &&
        row.trial_ends_at &&
        new Date(row.programa_en_marcha_at) < new Date(row.trial_ends_at) &&
        new Date(row.primer_cliente_at) < new Date(row.trial_ends_at),
      ),
    },
    created_at: new Date(row.created_at).toISOString(),
  };
}

superTrialRoutes.get(
  "/super/trials",
  requireSuperAdmin,
  validateQuery(TrialsQuerySchema),
  asyncRoute(
    /** @param {Request & WithValidatedQuery<TrialsQuery>} req @param {Response} res */
    async (req, res) => {
      const now = new Date();
      const { status, limit } = req.validatedQuery;
      const rows = await TrialRepo.listTrials({ limit });
      const trials = rows
        .map((row) => trialListingEntry(row, now))
        .filter((entry) => {
          if (status === "all") return true;
          if (status === "trialing")
            return entry.status === "active" || entry.status === "expiring";
          if (status === "purge") return entry.purge_candidate;
          return entry.status === status;
        });
      res.json({ ok: true, now: now.toISOString(), trials });
    },
  ),
);

superTrialRoutes.get(
  "/super/trials/summary",
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      const now = new Date();
      const cohorts = await TrialRepo.weeklySummary(now);
      res.json({
        ok: true,
        now: now.toISOString(),
        cohorts,
        definitions: {
          starts: "businesses whose trial started in the ISO week",
          activated: "programa_en_marcha and primer_cliente reached before trial_ends_at",
          converted: "trial_status = converted",
          locked: "billing_status = locked today",
          purge_candidates: "locked and purge_after in the past (dry run; nothing is deleted)",
          median_days_to_primer_cliente: "median days from trial start to the first customer",
          note: "Cohort counts describe what happened; they do not establish causation.",
        },
      });
    },
  ),
);

superTrialRoutes.get(
  "/super/trials/purge-candidates",
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      const now = new Date();
      const candidates = await purgeDryRun({ now });
      res.json({
        ok: true,
        mode: "dry_run",
        now: now.toISOString(),
        retention_days: config.TRIAL_RETENTION_DAYS,
        candidates: candidates.map((c) => ({
          ...c,
          purge_after: new Date(c.purge_after).toISOString(),
          locked_at: c.locked_at ? new Date(c.locked_at).toISOString() : null,
        })),
      });
    },
  ),
);

superTrialRoutes.post(
  "/super/businesses/:businessId/trial/extend",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = TrialExtendSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Payload inválido", code: "VALIDATION_ERROR" });
      /** @type {TrialExtendInput} */
      const payload = parsed.data;
      const businessId = String(req.params.businessId || "");
      const business = await BusinessRepo.getById(businessId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const now = new Date();
      const updated = await TrialRepo.extend({ businessId, days: payload.days, now });
      if (!updated)
        return res.status(409).json({
          error: "Solo se puede extender una prueba activa o vencida.",
          code: "TRIAL_NOT_EXTENDABLE",
        });
      countTrialTransition("extended");
      await auditPlatformAction({
        req,
        action: "super.trial.extend",
        businessId,
        meta: {
          days: payload.days,
          note: payload.note ?? null,
          trial_ends_at: new Date(updated.trial_ends_at).toISOString(),
          previous_trial_ends_at: business.trial_ends_at
            ? new Date(business.trial_ends_at).toISOString()
            : null,
          previous_billing_status: business.billing_status,
        },
      });
      await withDbClientContext({ tenantId: businessId, platformAdmin: false }, () =>
        emitBillingEvent({
          businessId,
          eventType: "trial.extended",
          metadata: { days: payload.days, trial_ends_at: new Date(updated.trial_ends_at) },
        }),
      );
      res.json({
        ok: true,
        business: { id: updated.id, name: updated.name, plan: updated.plan },
        trial: trialState(updated, { now, timezone: regionTimezone(updated) }),
      });
    },
  ),
);

superTrialRoutes.post(
  "/super/businesses/:businessId/trial/lock",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const businessId = String(req.params.businessId || "");
      const business = await BusinessRepo.getById(businessId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const now = new Date();
      const purgeAfter = new Date(now.getTime() + config.TRIAL_RETENTION_DAYS * DAY_MS);
      const lockedId = await TrialRepo.lockNow({ businessId, now, purgeAfter });
      if (!lockedId)
        return res.status(409).json({
          error: "Solo se puede bloquear un negocio en prueba.",
          code: "TRIAL_NOT_LOCKABLE",
        });
      countTrialTransition("locked");
      await auditPlatformAction({
        req,
        action: "super.trial.lock",
        businessId,
        meta: { purge_after: purgeAfter.toISOString() },
      });
      await withDbClientContext({ tenantId: businessId, platformAdmin: false }, () =>
        emitBillingEvent({
          businessId,
          eventType: "trial.locked",
          metadata: { by: "super", purge_after: purgeAfter.toISOString() },
        }),
      );
      const updated = await BusinessRepo.getById(businessId);
      res.json({
        ok: true,
        trial: trialState(updated, { now, timezone: regionTimezone(updated ?? undefined) }),
      });
    },
  ),
);

// Bank-transfer or invoiced customers: the platform owner activates the plan by hand and
// the system records a manual subscription (provider 'manual') with who did it and when.
superTrialRoutes.post(
  "/super/businesses/:businessId/billing/manual-activate",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = ManualActivateSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Payload inválido", code: "VALIDATION_ERROR" });
      /** @type {ManualActivateInput} */
      const payload = parsed.data;
      const plan = requireSupportedPlan(payload.plan);
      const businessId = String(req.params.businessId || "");
      const business = await BusinessRepo.getById(businessId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      // Same rule as the online checkout: Guatemalan businesses pay in quetzales, the rest
      // in USD, unless the super admin chooses explicitly (manual activation needs no price ids).
      const currency = payload.currency ?? (businessPaysInGtq(business) ? "GTQ" : "USD");
      const now = new Date();
      const catalog = await BillingCatalogService.get();
      const planKey = /** @type {keyof typeof catalog.usd} */ (plan);
      const unitAmount = currency === "GTQ" ? catalog.gtq[planKey] : catalog.usd[planKey];
      const quantity = Math.max(1, await BusinessRepo.countBranches(businessId));
      const wasTrial = business.trial_status !== "none";
      const updated = await TrialRepo.convert({ businessId, plan, currency });
      if (!updated) return res.status(404).json({ error: "Negocio no encontrado" });
      await TrialRepo.upsertManualCustomer({ businessId, email: updated.email });
      const subscription = await TrialRepo.replaceManualSubscription({
        id: crypto.randomUUID(),
        businessId,
        plan,
        quantity,
        currency,
        unitAmountMinor: Math.round(Number(unitAmount) * 100),
        now,
        metadata: {
          activated_by: req.superAdmin?.email ?? null,
          activated_at: now.toISOString(),
          note: payload.note ?? null,
          previous_plan: business.plan,
          previous_billing_status: business.billing_status,
          previous_trial_status: business.trial_status,
        },
      });
      if (wasTrial) countTrialTransition("converted");
      await auditPlatformAction({
        req,
        action: "super.billing.manual_activate",
        businessId,
        meta: {
          plan,
          currency,
          quantity,
          unit_amount_minor: Math.round(Number(unitAmount) * 100),
          note: payload.note ?? null,
          previous_plan: business.plan,
          previous_billing_status: business.billing_status,
          converted_from_trial: wasTrial,
        },
      });
      await withDbClientContext({ tenantId: businessId, platformAdmin: false }, async () => {
        if (wasTrial)
          await emitBillingEvent({
            businessId,
            eventType: "trial.converted",
            metadata: { plan, provider: "manual", by: req.superAdmin?.email ?? null },
          });
        await emitBillingEvent({
          businessId,
          eventType: "subscription.activated",
          metadata: { plan, provider: "manual", currency, quantity },
        });
      });
      res.json({
        ok: true,
        business: {
          id: updated.id,
          name: updated.name,
          plan: updated.plan,
          plan_name: planDisplayName(updated.plan),
          billing_status: updated.billing_status,
          trial_status: updated.trial_status,
        },
        subscription: subscription
          ? {
              id: subscription.id,
              provider: subscription.provider,
              plan: subscription.plan,
              quantity: Number(subscription.quantity),
              currency: subscription.currency,
              unit_amount_minor: Number(subscription.unit_amount_minor),
              status: subscription.status,
              metadata: subscription.metadata,
            }
          : null,
      });
    },
  ),
);

superTrialRoutes.get(
  "/super/billing/catalog",
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      res.json({ ok: true, catalog: await BillingCatalogService.get() });
    },
  ),
);

superTrialRoutes.put(
  "/super/billing/catalog",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = BillingCatalogSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Payload inválido", code: "VALIDATION_ERROR" });
      const catalog = await BillingCatalogService.set(parsed.data);
      // Platform-level change (no business): structured log plus a security event, like
      // the other platform-wide settings.
      logger.info(
        { action: "super.billing_catalog.update", superAdminEmail: req.superAdmin.email, catalog },
        "Billing catalog updated",
      );
      await SecurityEventRepo.log({
        event_type: "super.billing_catalog.update",
        severity: "LOW",
        route: req.originalUrl ?? null,
        method: req.method,
        ip: getRequestIp(req) || null,
        actor_type: "SUPER_ADMIN",
        meta: { super_admin_email: req.superAdmin.email, usd: catalog.usd, gtq: catalog.gtq },
      }).catch(() => {});
      res.json({ ok: true, catalog });
    },
  ),
);
