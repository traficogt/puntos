import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { config } from "../../../config/index.js";
import { WebhookRepo } from "../../repositories/webhook-repository.js";
import { validateWebhookUrl } from "../../../utils/webhook-url.js";
import { makeId, maskSecret } from "./_util.js";

export const adminWebhookRoutes = Router();

const WebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8),
  events: z.array(z.string()).min(1)
});

adminWebhookRoutes.get(
  "/admin/webhooks",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("webhooks"),
  asyncRoute(async (req, res) => {
    const endpoints = await WebhookRepo.listEndpoints(req.tenantId);
    const safeEndpoints = endpoints.map((ep) => ({
      ...ep,
      secret: undefined,
      secret_masked: maskSecret(ep.secret),
      has_secret: Boolean(ep.secret)
    }));
    return res.json({ ok: true, endpoints: safeEndpoints });
  })
);

adminWebhookRoutes.post(
  "/admin/webhooks",
  requireStaff,
  requireOwner,
  tenantContext,
  csrfProtect,
  requirePlanFeature("webhooks"),
  asyncRoute(async (req, res) => {
    const v = validate(WebhookSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    try {
      await validateWebhookUrl(v.data.url, {
        requireHttps: config.WEBHOOK_REQUIRE_HTTPS,
        allowlist: config.WEBHOOK_ALLOWLIST
      });
    } catch (e) {
      return res.status(400).json({ error: e?.message ?? "Invalid webhook URL" });
    }

    const ep = await WebhookRepo.createEndpoint({
      id: makeId(),
      business_id: req.tenantId,
      url: v.data.url,
      secret: v.data.secret,
      events: v.data.events,
      active: true
    });

    return res.json({
      ok: true,
      endpoint: {
        ...ep,
        secret: undefined,
        secret_masked: maskSecret(ep.secret),
        has_secret: Boolean(ep.secret)
      }
    });
  })
);

