import { dateTimeSchema } from '../../utils/date-time-schema.js';
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";

import { asyncRoute } from "../../middleware/common.js";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { config } from "../../config/index.js";
import { processOrder } from "../services/order-service.js";
import { validate } from "../../utils/validation.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";

export const orderRoutes = Router();

const OrderLineItemSchema = z.object({
  code: z.string().max(120).optional(),
  name: z.string().min(1).max(160),
  category: z.string().max(120).optional(),
  quantity: z.number().positive(),
  unit_price_q: z.number().nonnegative().optional(),
  line_total_q: z.number().nonnegative().optional()
});

export const OrderCreateSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  externalOrderId: z.string().min(1).max(160),
  customerId: z.guid().optional(),
  customerPhone: z.string().min(6).optional(),
  identifierType: z.string().min(1).max(120).optional(),
  identifierValue: z.string().min(1).max(200).optional(),
  status: z.enum(["paid", "completed"]),
  amount_q: z.number().nonnegative(),
  subtotal_q: z.number().nonnegative().optional(),
  discount_q: z.number().nonnegative().optional(),
  tax_q: z.number().nonnegative().optional(),
  currency: z.string().min(3).max(3).optional(),
  occurred_at: dateTimeSchema().optional(),
  items: z.array(OrderLineItemSchema).max(500).optional(),
  meta: z.record(z.string(), z.any()).optional()
})
  .refine((value) => {
    const hasIdentifierPair = Boolean(value.identifierType && value.identifierValue);
    return Boolean(value.customerId || value.customerPhone || hasIdentifierPair);
  }, {
    message: "customerId, customerPhone, or identifierType and identifierValue are required"
  })
  .refine((value) => {
    const hasIdentifierType = Boolean(value.identifierType);
    const hasIdentifierValue = Boolean(value.identifierValue);
    return hasIdentifierType === hasIdentifierValue;
  }, {
    message: "identifierType and identifierValue must be provided together"
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

orderRoutes.post("/public/orders", moderateRateLimit, asyncRoute(async (req, res) => {
  const parsed = validate(OrderCreateSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  parsed.data.line_items_json = Array.isArray(parsed.data.items) ? parsed.data.items : [];

  const signature = String(req.headers["x-signature"] || "");
  if (!verifySignature(req.rawBody, parsed.data.businessSlug, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const out = await processOrder(parsed.data);
  res.json(out);
}));
