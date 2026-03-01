import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { validate } from "../../utils/validation.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { normalizePhone } from "../../utils/phone.js";
import { requestJoinCode, verifyJoinCode, issueCustomerQr } from "../services/customer-service.js";
import { awardFromExternalEventTrusted } from "../services/external-award-service.js";
import { config } from "../../config/index.js";
import { cookieOpts } from "../../utils/auth-token.js";
import { requireCustomer } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { moderateRateLimit, rateLimitByPhone, strictRateLimit } from "../../middleware/rate-limit.js";
import QRCode from "qrcode";
import { createBusinessWithOwner } from "../services/business-service.js";
import crypto from "node:crypto";
import { setTenantForRequest } from "../../middleware/tenant.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";
import { passwordSchema } from "../../utils/schemas.js";

export const publicRoutes = Router();

function sanitizeProgramJsonForPublic(programJson) {
  const json = programJson && typeof programJson === "object" ? { ...programJson } : {};
  if (json.external_awards && typeof json.external_awards === "object") {
    json.external_awards = {
      enabled: Boolean(json.external_awards.enabled)
    };
  }
  return json;
}

publicRoutes.get("/public/business/:slug", asyncRoute(async (req, res) => {
  const business = await BusinessRepo.getPublicBySlug(req.params.slug);
  if (!business) return res.status(404).json({ error: "Business not found" });
  res.json({
    id: business.id,
    name: business.name,
    slug: business.slug,
    category: business.category,
    program_type: business.program_type,
    program_json: sanitizeProgramJsonForPublic(business.program_json)
  });
}));

publicRoutes.get("/public/keys", (req, res) => {
  // for future client-side verification if needed
  res.json({ qr_public_key_pem: config.QR_PUBLIC_KEY_PEM || null });
});

const RequestCodeSchema = z.object({
  phone: z.string().min(6),
  name: z.string().max(120).optional()
});

publicRoutes.post("/public/business/:slug/join/request-code", strictRateLimit, rateLimitByPhone(3, 10 * 60 * 1000), asyncRoute(async (req, res) => {
  const v = validate(RequestCodeSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

	const business = await BusinessRepo.getPublicBySlug(req.params.slug);
	if (!business) return res.status(404).json({ error: "Business not found" });
	await setTenantForRequest(req, business.id);

	const phone = normalizePhone(v.data.phone);
	const out = await requestJoinCode({ business, phone, name: v.data.name ?? null });

  res.json(out);
}));

const VerifySchema = z.object({
  phone: z.string().min(6),
  code: z.string().min(4).max(10),
  name: z.string().max(120).optional(),
  referralCode: z.string().length(6).optional() // Optional 6-char referral code
});

publicRoutes.post("/public/business/:slug/join/verify", moderateRateLimit, rateLimitByPhone(10, 10 * 60 * 1000), asyncRoute(async (req, res) => {
  const v = validate(VerifySchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

	const business = await BusinessRepo.getPublicBySlug(req.params.slug);
	if (!business) return res.status(404).json({ error: "Business not found" });
	await setTenantForRequest(req, business.id);

	const phone = normalizePhone(v.data.phone);
	const { customer, token } = await verifyJoinCode({
    business,
    phone,
    code: v.data.code,
    name: v.data.name ?? null,
    referralCode: v.data.referralCode ?? null // Pass referral code if provided
  });

  res.cookie(config.CUSTOMER_COOKIE_NAME, token, { ...cookieOpts(), maxAge: 180 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, customer: { id: customer.id, points: customer.points, name: customer.name, phone: customer.phone } });
}));

publicRoutes.post("/public/customer/logout", csrfProtect, (req, res) => {
  res.clearCookie(config.CUSTOMER_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

publicRoutes.post("/public/customer/qr", csrfProtect, requireCustomer, asyncRoute(async (req, res) => {
  const { id: customerId, business_id } = req.customerAuth;
  const out = await issueCustomerQr({ businessId: business_id, customerId });
  res.json(out);
}));

const ExternalAwardSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  externalEventId: z.string().min(4).max(120),
  customerId: z.string().uuid().optional(),
  customerPhone: z.string().min(6).optional(),
  amount_q: z.number().nonnegative().optional(),
  visits: z.number().int().nonnegative().optional(),
  items: z.number().int().nonnegative().optional(),
  meta: z.record(z.any()).optional()
}).refine(v => Boolean(v.customerId || v.customerPhone), {
  message: "customerId or customerPhone is required"
});

publicRoutes.post("/public/external/award", moderateRateLimit, asyncRoute(async (req, res) => {
  const rawBody = req.rawBody;
  if (!rawBody) {
    return res.status(400).json({ error: "Missing raw body for signature verification" });
  }
  const businessSlug = req.body?.businessSlug;
  const secret = businessSlug ? config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[businessSlug] : null;
  if (!secret) {
    return res.status(503).json({ error: "External awards disabled for this business" });
  }
  const sig = String(req.headers["x-signature"] || "").trim().toLowerCase();
  const expected = crypto
    .createHmac("sha256", String(secret))
    .update(rawBody)
    .digest("hex");
  if (!timingSafeEqualString(sig, expected)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
	const v = validate(ExternalAwardSchema, req.body);
	if (!v.ok) return res.status(400).json({ error: v.error });
	const business = await BusinessRepo.getPublicBySlug(v.data.businessSlug);
	if (!business) return res.status(404).json({ error: "Business not found" });
	await setTenantForRequest(req, business.id);
	const out = await awardFromExternalEventTrusted({
	  businessSlug: business.slug,
	  externalEventId: v.data.externalEventId,
	  customerId: v.data.customerId,
	  customerPhone: v.data.customerPhone ? normalizePhone(v.data.customerPhone) : undefined,
	  amount_q: v.data.amount_q ?? 0,
    visits: v.data.visits ?? 0,
    items: v.data.items ?? 0,
    meta: v.data.meta ?? {}
  });
  res.json(out);
}));

const BusinessRegisterSchema = z.object({
  name: z.string().min(3).max(140),
  slug: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/),
  email: z.string().email(),
  password: passwordSchema,
  phone: z.string().min(8),
  category: z.string().max(50).optional(),
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]).optional(),
  registration_token: z.string().min(16).optional()
});

publicRoutes.post("/public/business/register", strictRateLimit, asyncRoute(async (req, res) => {
  const v = validate(BusinessRegisterSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  // Optional shared secret for production; if set, require correct token
  if (config.REGISTRATION_API_KEY) {
    const tok = v.data.registration_token || req.headers["x-registration-token"];
    if (tok !== config.REGISTRATION_API_KEY) {
      return res.status(401).json({ error: "Invalid registration token" });
    }
  }

  // Enforce provided slug uniqueness; service will adjust if necessary.
  const existingSlug = await BusinessRepo.getPublicBySlug(v.data.slug);
  if (existingSlug) {
    return res.status(409).json({ error: "Slug already in use" });
  }

  const { business } = await createBusinessWithOwner({
    businessName: v.data.name,
    email: v.data.email,
    phone: normalizePhone(v.data.phone),
    password: v.data.password,
    category: v.data.category ?? null,
    program_type: v.data.program_type ?? "SPEND",
    program_json: undefined,
    slug: v.data.slug
  });

  res.status(201).json({
    id: business.id,
    slug: business.slug,
    name: business.name,
    program_type: business.program_type
  });
}));

// Convenient endpoint for customer UI: returns an SVG QR for the short-lived token
publicRoutes.get("/public/customer/qr.svg", requireCustomer, asyncRoute(async (req, res) => {
  const { id: customerId, business_id } = req.customerAuth;
  const out = await issueCustomerQr({ businessId: business_id, customerId });
  const svg = await QRCode.toString(out.token, {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin: 2,
    scale: 10
  });

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-QR-Exp", String(out.exp));
  res.setHeader("X-QR-JTI", String(out.jti));
  res.setHeader("X-QR-Token", String(out.token));
  res.send(svg);
}));
