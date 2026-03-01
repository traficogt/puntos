import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { validateQuery } from "../../utils/schemas.js";
import { requireStaff, requireStaffRoles } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../utils/validation.js";
import {
  listPaymentWebhookEventsForBusiness,
  processPaymentWebhook,
  resolvePaymentWebhookEventForBusiness
} from "../services/payment-webhook-service.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { tenantContext } from "../../middleware/tenant.js";
import { getRequestIp } from "../../utils/request-ip.js";

export const paymentWebhookRoutes = Router();

const PaymentWebhookListQuerySchema = z.object({
  status: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().max(30).optional()),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

paymentWebhookRoutes.post("/public/payments/webhook/:provider", moderateRateLimit, asyncRoute(async (req, res) => {
  const provider = String(req.params.provider || "").trim().toLowerCase();
  const secretHeader = String(req.headers["x-webhook-secret"] || req.headers["x-signature"] || "");
  const signatureHeader = String(req.headers["x-signature"] || req.headers["x-provider-signature"] || "");
  let out;
  try {
    out = await processPaymentWebhook({
      provider,
      payload: req.body ?? {},
      secretHeader,
      signatureHeader,
      rawBody: req.rawBody || ""
    });
  } catch (err) {
    const status = Number(err?.statusCode || err?.status || 500);
    if (status === 403) {
      await SecurityEventRepo.log({
        event_type: "webhook_auth_failed",
        severity: "HIGH",
        route: req.originalUrl || req.url,
        method: "POST",
        ip: getRequestIp(req),
        actor_type: "ANON",
        meta: { provider, reason: String(err?.message || "forbidden") }
      }).catch(() => { });
    }
    throw err;
  }
  res.status(202).json(out);
}));

paymentWebhookRoutes.get(
  "/admin/payment-webhooks",
  requireStaff,
  tenantContext,
  requireStaffRoles("OWNER", "MANAGER"),
  validateQuery(PaymentWebhookListQuerySchema),
  asyncRoute(async (req, res) => {
  const status = req.validatedQuery.status ? String(req.validatedQuery.status) : null;
  const { limit } = req.validatedQuery;
  const rows = await listPaymentWebhookEventsForBusiness({
    businessId: req.tenantId,
    status,
    limit
  });
  res.json({ ok: true, events: rows });
}));

const ResolveSchema = z.object({
  customerId: z.string().uuid().optional(),
  customerPhone: z.string().min(6).optional()
}).refine((v) => Boolean(v.customerId || v.customerPhone), {
  message: "customerId or customerPhone is required"
});

paymentWebhookRoutes.post("/admin/payment-webhooks/:id/resolve", csrfProtect, requireStaff, tenantContext, requireStaffRoles("OWNER", "MANAGER"), asyncRoute(async (req, res) => {
  const v = validate(ResolveSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const out = await resolvePaymentWebhookEventForBusiness({
    businessId: req.tenantId,
    eventId: req.params.id,
    customerId: v.data.customerId,
    customerPhone: v.data.customerPhone
  });
  res.json(out);
}));
