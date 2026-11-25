// Owner billing surface for "Plan y facturación" (design sections 4.4, 4.5 and 7.3):
// overview, hosted checkout, checkout polling, plan change, cancel at period end and
// the payment list with the FEL invoice links. Owner role only; every path under
// /admin/billing/ is exempt from the trial lock (middleware/billing-status.js) because
// it is the way out of the lock.
import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { validate } from "../../../utils/validation.js";
import { subscriptionService } from "../../services/billing/subscription-service.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */
/** @typedef {import("../../services/billing/subscription-service.js").SubscriptionService} SubscriptionService */
/** @typedef {Promise<Response | void>} HandlerResult */

export const BillingCheckoutSchema = z
  .object({
    plan: z.enum(["EMPRENDEDOR", "NEGOCIO", "EMPRESA"]),
    currency: z.enum(["GTQ", "USD"]).optional(),
  })
  .strict();
export const BillingChangeSchema = z
  .object({ plan: z.enum(["EMPRENDEDOR", "NEGOCIO", "EMPRESA"]) })
  .strict();
// Immediate cancellation is a super-console action (design section 4.5); owners can only
// stop the renewal.
export const BillingCancelSchema = z.object({ at_period_end: z.literal(true) }).strict();

/** @typedef {z.infer<typeof BillingCheckoutSchema>} BillingCheckoutInput */

/**
 * @param {{
 *   service?: () => Pick<SubscriptionService,
 *     "overview" | "invoices" | "startCheckout" | "checkoutStatus" | "changePlan" | "cancel">,
 *   staffAuth?: import("express").RequestHandler
 * }} [deps]
 */
export function createAdminBillingSubscriptionRoutes({
  service = subscriptionService,
  staffAuth = requireStaff,
} = {}) {
  const router = Router();
  const guards = [staffAuth, requireOwner, tenantContext];
  router.use(
    "/admin/billing",
    /** @param {import("express").Request} _req @param {Response} res @param {import("express").NextFunction} next */
    (_req, res, next) => {
      res.set("Cache-Control", "private, no-store");
      next();
    },
  );

  router.get(
    "/admin/billing",
    ...guards,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const out = await service().overview(req.tenantId);
        return res.json({ ok: true, ...out });
      },
    ),
  );

  router.get(
    "/admin/billing/invoices",
    ...guards,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        return res.json({ ok: true, invoices: await service().invoices(req.tenantId) });
      },
    ),
  );

  router.post(
    "/admin/billing/checkout",
    ...guards,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const v = validate(BillingCheckoutSchema, req.body);
        if (!v.ok) return res.status(400).json({ error: v.error, code: "BILLING_PLAN_INVALID" });
        const out = await service().startCheckout({
          businessId: req.tenantId,
          plan: v.data.plan,
          currency: v.data.currency ?? null,
        });
        return res.status(out.reused ? 200 : 201).json({
          ok: true,
          reused: out.reused,
          checkout: {
            id: out.checkout.id,
            url: out.checkout.url,
            expires_at: out.checkout.expires_at,
            plan: out.checkout.plan,
            quantity: out.checkout.quantity,
            currency: out.checkout.currency,
            unit_amount_minor: out.checkout.unit_amount_minor,
          },
        });
      },
    ),
  );

  router.get(
    "/admin/billing/checkout/:id",
    ...guards,
    asyncRoute(
      /** @param {import("../_request-types.js").TenantRequest<{ id: string }>} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const id = z.guid().safeParse(req.params.id);
        if (!id.success)
          return res
            .status(404)
            .json({ error: "Pago no encontrado", code: "BILLING_CHECKOUT_NOT_FOUND" });
        const out = await service().checkoutStatus({
          businessId: req.tenantId,
          checkoutId: id.data,
        });
        return res.json({ ok: true, ...out });
      },
    ),
  );

  router.post(
    "/admin/billing/change",
    ...guards,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const v = validate(BillingChangeSchema, req.body);
        if (!v.ok) return res.status(400).json({ error: v.error, code: "BILLING_PLAN_INVALID" });
        const subscription = await service().changePlan({
          businessId: req.tenantId,
          plan: v.data.plan,
        });
        return res.json({ ok: true, subscription });
      },
    ),
  );

  router.post(
    "/admin/billing/cancel",
    ...guards,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const v = validate(BillingCancelSchema, req.body);
        if (!v.ok) return res.status(400).json({ error: v.error, code: "VALIDATION_ERROR" });
        const subscription = await service().cancel({
          businessId: req.tenantId,
          atPeriodEnd: true,
          by: req.staff?.id ?? null,
        });
        return res.json({ ok: true, subscription });
      },
    ),
  );

  return router;
}

export const adminBillingSubscriptionRoutes = createAdminBillingSubscriptionRoutes();
