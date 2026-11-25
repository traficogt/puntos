// Provider webhooks for subscription billing (design section 4.4, step 4). No CSRF:
// the Svix signature over the raw body (src/middleware/raw-body.js) authenticates the
// sender. 401 on a bad signature, 200 `{ ok, duplicate: true }` on a redelivery, never
// 5xx for an unknown event type (stored as `ignored`); a processing failure answers 500
// so Recurrente redelivers (immediately, 1 min, 5 min, 30 min, 2 h, 6 h).
import { Router } from "express";
import { asyncRoute } from "../../middleware/common.js";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { getRequestIp } from "../../utils/request-ip.js";
import { safeLogUrl } from "../../utils/logger.js";
import { isProviderName } from "../services/billing/provider.js";
import { subscriptionService } from "../services/billing/subscription-service.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("../services/billing/subscription-service.js").SubscriptionService} SubscriptionService */

/**
 * @param {{
 *   service?: () => Pick<SubscriptionService, "handleWebhook">,
 *   rateLimit?: import("express").RequestHandler,
 *   logSecurityEvent?: typeof SecurityEventRepo.log
 * }} [deps]
 */
export function createPublicBillingWebhookRoutes({
  service = subscriptionService,
  rateLimit = moderateRateLimit,
  logSecurityEvent = (entry) => SecurityEventRepo.log(entry),
} = {}) {
  const router = Router();
  router.post(
    "/public/billing/webhooks/:provider",
    rateLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const provider = String(req.params.provider || "").toLowerCase();
        if (!isProviderName(provider) || provider === "manual")
          return res.status(404).json({ error: "Proveedor desconocido", code: "NOT_FOUND" });
        const rawBody = typeof req.rawBody === "string" ? req.rawBody : "";
        const result = await service().handleWebhook({
          provider,
          rawBody,
          headers: /** @type {Record<string, string | string[] | undefined>} */ (req.headers),
        });
        if (result.status === 401) {
          await logSecurityEvent({
            event_type: "billing_webhook_auth_failed",
            severity: "HIGH",
            route: safeLogUrl(req.originalUrl || req.url),
            method: "POST",
            ip: getRequestIp(req),
            actor_type: "ANON",
            meta: { provider },
          }).catch(() => {});
        }
        return res.status(result.status).json(result.body);
      },
    ),
  );
  return router;
}

export const publicBillingWebhookRoutes = createPublicBillingWebhookRoutes();
