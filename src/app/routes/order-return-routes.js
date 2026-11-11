import { dateTimeSchema } from '../../utils/date-time-schema.js';
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";

import { asyncRoute } from "../../middleware/common.js";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { config } from "../../config/index.js";
import { processOrderReturn as processOrderReturnService } from "../services/order-return-service.js";
import { validate } from "../../utils/validation.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";

export const OrderReturnCreateSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  externalReturnId: z.string().min(1).max(160),
  externalOrderId: z.string().min(1).max(160),
  reason: z.string().min(1).max(240).optional(),
  occurred_at: dateTimeSchema().optional(),
  meta: z.record(z.string(), z.any()).optional()
});

function normalizeSignature(signature) {
  const raw = String(signature || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("sha256=")) return raw.slice(7).trim();
  return raw;
}

function verifySignature(rawBody, businessSlug, signature) {
  const secret = businessSlug ? config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[businessSlug] : null;
  if (!secret || !rawBody) return false;
  const expected = crypto.createHmac("sha256", String(secret)).update(String(rawBody)).digest("hex");
  return timingSafeEqualString(normalizeSignature(signature), expected);
}

export function createOrderReturnRoutes(deps = {}) {
  const router = Router();
  const processOrderReturn = deps.processOrderReturn ?? processOrderReturnService;

  router.post("/public/order-returns", moderateRateLimit, asyncRoute(async (req, res) => {
    const parsed = validate(OrderReturnCreateSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const signature = String(req.headers["x-signature"] || "");
    if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const out = await processOrderReturn(parsed.data);
    return res.json(out);
  }));

  return router;
}

export const orderReturnRoutes = createOrderReturnRoutes();
