import { businessRegion } from "../services/regional-settings.js";
import { normalizeEnrollmentPhone } from "../services/regional-phone.js";
import { Router } from "express";
import { z } from "zod";
import nodeCrypto from "node:crypto";
import { asyncRoute } from "../../middleware/common.js";
import { validate } from "../../utils/validation.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { InternalMagicLinkRepo } from "../repositories/internal-magic-link-repository.js";
import { normalizePhone } from "../../utils/phone.js";
import { sanitizeProgramForClient } from "../../utils/program-secrets.js";
import { requestJoinCode, verifyJoinCode, issueCustomerQr } from "../services/customer-service.js";
import { awardFromExternalEventTrusted } from "../services/external-award-service.js";
import { config } from "../../config/index.js";
import {
  browserCookieMaxAge,
  cookieOpts,
  customerCookieOptions,
  staffCookieOptions,
} from "../../utils/auth-token.js";
import { requireCustomer } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import {
  moderateRateLimit,
  rateLimitByPhone,
  strictRateLimit,
} from "../../middleware/rate-limit.js";
import QRCode from "qrcode";
import { createBusinessWithOwner } from "../services/business-service.js";
import crypto from "node:crypto";
import { setTenantForRequest } from "../../middleware/tenant.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";
import {
  businessCustomerBrandingSchema,
  businessRegisterSchema,
  requestJoinCodeSchema,
  verifyJoinCodeSchema,
} from "../../utils/schemas.js";
import { invalidateBrowserSessionById } from "../services/auth-session-service.js";
import {
  completeStaffPasswordReset,
  confirmStaffEmailChange,
  requestStaffPasswordReset,
} from "../services/account-security-service.js";
import { consumeInternalMagicLink } from "../services/internal-magic-link-service.js";
import { sendContactEmail, verifyTurnstile } from "../services/contact-service.js";
import { getRequestIp } from "../../utils/request-ip.js";
import { withDbClientContext } from "../database.js";
import { errorCode, errorMessage } from "../../utils/error-shape.js";

export const publicRoutes = Router();

const StaffPasswordResetRequestSchema = z.object({
  email: z.string().email(),
});

const StaffPasswordResetConfirmSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});

const StaffTokenConfirmSchema = z.object({
  token: z.string().min(20),
});

const ContactSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  business: z.string().min(1).max(160).trim(),
  contact: z.string().min(1).max(200).trim(),
  message: z.string().min(10).max(2000).trim(),
  turnstileToken: z.string().min(1).max(4096),
});

export const ExternalAwardSchema = z
  .object({
    businessSlug: z.string().min(2).max(120),
    externalEventId: z.string().min(4).max(120),
    customerId: z.guid().optional(),
    customerPhone: z.string().min(6).optional(),
    amount_q: z.number().nonnegative().optional(),
    visits: z.number().int().nonnegative().optional(),
    items: z.number().int().nonnegative().optional(),
    meta: z.record(z.string(), z.any()).optional(),
  })
  .refine((v) => Boolean(v.customerId || v.customerPhone), {
    message: "customerId or customerPhone is required",
  });

// --- shared helpers ------------------------------------------------------------

function rejectMissingCustomer(req, res) {
  res.clearCookie(config.CUSTOMER_COOKIE_NAME, { path: "/" });
  return res.status(404).json({ error: "Cliente no encontrado", code: "CUSTOMER_NOT_FOUND" });
}

function sanitizeCustomerBrandingForPublic(customerBrandingJson) {
  const parsed = businessCustomerBrandingSchema.safeParse(
    customerBrandingJson && typeof customerBrandingJson === "object" ? customerBrandingJson : {},
  );
  if (parsed.success) return parsed.data;
  return businessCustomerBrandingSchema.parse({});
}

async function lookupMagicLinkRecord(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  const tokenHash = nodeCrypto.createHash("sha256").update(token).digest("hex");
  return withMagicLinkDbContext(() => InternalMagicLinkRepo.lookupByTokenHash(tokenHash));
}

async function withMagicLinkDbContext(task) {
  try {
    if (config.NODE_ENV === "test") {
      return task();
    }
    return withDbClientContext({ platformAdmin: true, tenantId: null }, task);
  } catch (error) {
    const code = String(errorCode(error) || "");
    const message = String(errorMessage(error) || "");
    if (code === "28P01" || /password authentication failed/i.test(message)) {
      return task();
    }
    throw error;
  }
}

// Validates the body, resolves the public business from :slug and binds the
// request to its tenant. Sends the error response and returns null on failure.
async function resolvePublicBusinessRequest(req, res, schema) {
  const v = validate(schema, req.body);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return null;
  }
  const business = await BusinessRepo.getPublicBySlug(req.params.slug);
  if (!business) {
    res.status(404).json({ error: "Negocio no encontrado" });
    return null;
  }
  await setTenantForRequest(req, business.id);
  return { data: v.data, business };
}

function issueCustomerSession(req, res, { customer, token }) {
  res.cookie(config.CUSTOMER_COOKIE_NAME, token, {
    ...cookieOpts(req),
    maxAge: browserCookieMaxAge("CUSTOMER"),
  });
  res.json({
    ok: true,
    customer: {
      id: customer.id,
      points: customer.points,
      name: customer.name,
      phone: customer.phone,
    },
  });
}

// Consumes an internal magic link for the expected actor type. Sends the error
// response and returns null when the link is unknown or for another actor.
async function consumePublicMagicLink(req, res, actorType) {
  const record = await lookupMagicLinkRecord(req.params.token);
  if (!record || record.actor_type !== actorType) {
    res.status(400).json({ error: "Este enlace no es válido." });
    return null;
  }
  return withMagicLinkDbContext(async () =>
    consumeInternalMagicLink(req.params.token, {
      ip: getRequestIp(req),
      ua: req.headers["user-agent"] || null,
    }),
  );
}

// Loads the cookie-authenticated customer and checks it still belongs to the
// session's business. Clears the cookie and responds 404 otherwise.
async function loadAuthenticatedCustomer(req, res) {
  const { id: customerId, business_id } = req.customerAuth;
  const customer = await CustomerRepo.getById(customerId);
  if (!customer || String(customer.business_id) !== String(business_id)) {
    rejectMissingCustomer(req, res);
    return null;
  }
  return { customerId, business_id };
}

function verifyExternalAwardSignature(req, res) {
  const rawBody = req.rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Missing raw body for signature verification" });
    return false;
  }
  const businessSlug = req.body?.businessSlug;
  const secret = businessSlug ? config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[businessSlug] : null;
  if (!secret) {
    res.status(503).json({ error: "External awards disabled for this business" });
    return false;
  }
  const sig = String(req.headers["x-signature"] || "")
    .trim()
    .toLowerCase();
  const expected = crypto.createHmac("sha256", String(secret)).update(rawBody).digest("hex");
  if (!timingSafeEqualString(sig, expected)) {
    res.status(401).json({ error: "Invalid signature" });
    return false;
  }
  return true;
}

// --- handlers ------------------------------------------------------------------

async function readPublicBusiness(req, res) {
  const business = await BusinessRepo.getPublicBySlug(req.params.slug);
  if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
  res.json({
    id: business.id,
    name: business.name,
    slug: business.slug,
    category: business.category,
    region: businessRegion(business),
    program_type: business.program_type,
    program_json: sanitizeProgramForClient(business.program_json),
    customer_branding: sanitizeCustomerBrandingForPublic(business.customer_branding_json),
  });
}

async function handleJoinRequestCode(req, res) {
  const resolved = await resolvePublicBusinessRequest(req, res, requestJoinCodeSchema);
  if (!resolved) return;
  const { data, business } = resolved;
  const out = await requestJoinCode({
    business,
    phone: data.phone,
    email: data.email ?? null,
    name: data.name ?? null,
  });
  res.json(out);
}

async function handleLoginRequestCode(req, res) {
  const resolved = await resolvePublicBusinessRequest(req, res, requestJoinCodeSchema);
  if (!resolved) return;
  const { data, business } = resolved;
  const out = await requestJoinCode({
    business,
    phone: data.phone,
    email: data.email ?? null,
    name: data.name ?? null,
    requireExisting: true,
  });
  res.json(out);
}

async function handleStaffPasswordResetRequest(req, res) {
  const v = validate(StaffPasswordResetRequestSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  await requestStaffPasswordReset({
    email: v.data.email,
    ip: req.ip || null,
    ua: req.headers["user-agent"] || null,
  });
  res.json({ ok: true });
}

async function handleStaffPasswordResetConfirm(req, res) {
  const v = validate(StaffPasswordResetConfirmSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  await completeStaffPasswordReset({
    token: v.data.token,
    newPassword: v.data.newPassword,
    ip: req.ip || null,
    ua: req.headers["user-agent"] || null,
  });
  res.json({ ok: true });
}

async function handleStaffEmailChangeConfirm(req, res) {
  const v = validate(StaffTokenConfirmSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const out = await confirmStaffEmailChange({
    token: v.data.token,
    ip: req.ip || null,
    ua: req.headers["user-agent"] || null,
  });
  res.json(out);
}

async function handleStaffMagicLink(req, res) {
  const out = await consumePublicMagicLink(req, res, "staff");
  if (!out) return;
  res.cookie(config.STAFF_COOKIE_NAME, out.token, staffCookieOptions(req));
  const destinations = new Map([
    ["/admin-dashboard", "/administracion/"],
    ["/staff", "/equipo/escaner/"],
  ]);
  res.redirect(destinations.get(out.redirectTo) || out.redirectTo);
}

async function handleCustomerMagicLink(req, res) {
  const out = await consumePublicMagicLink(req, res, "customer");
  if (!out) return;
  res.cookie(config.CUSTOMER_COOKIE_NAME, out.token, customerCookieOptions(req));
  const destinations = new Map([["/c", "/mi-tarjeta/?sesion=nueva"]]);
  res.redirect(destinations.get(out.redirectTo) || out.redirectTo);
}

async function handleJoinVerify(req, res) {
  const resolved = await resolvePublicBusinessRequest(req, res, verifyJoinCodeSchema);
  if (!resolved) return;
  const { data, business } = resolved;
  const session = await verifyJoinCode({
    business,
    phone: data.phone,
    code: data.code,
    name: data.name ?? null,
    referralCode: data.referralCode ?? null, // Pass referral code if provided
    visitToken: data.visitToken ?? null,
    marketingOptIn: data.marketingOptIn === true,
  });
  issueCustomerSession(req, res, session);
}

async function handleLoginVerify(req, res) {
  const resolved = await resolvePublicBusinessRequest(req, res, verifyJoinCodeSchema);
  if (!resolved) return;
  const { data, business } = resolved;
  const session = await verifyJoinCode({
    business,
    phone: data.phone,
    code: data.code,
    name: data.name ?? null,
    referralCode: null,
    requireExisting: true,
  });
  issueCustomerSession(req, res, session);
}

async function handleCustomerLogout(req, res) {
  if (req.authSession?.id) {
    await invalidateBrowserSessionById(req.authSession.id, "logout");
  }
  res.clearCookie(config.CUSTOMER_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
}

async function handleCustomerQr(req, res) {
  const auth = await loadAuthenticatedCustomer(req, res);
  if (!auth) return;
  const out = await issueCustomerQr({ businessId: auth.business_id, customerId: auth.customerId });
  res.json(out);
}

async function handleExternalAward(req, res) {
  if (!verifyExternalAwardSignature(req, res)) return;
  const v = validate(ExternalAwardSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const business = await BusinessRepo.getPublicBySlug(v.data.businessSlug);
  if (!business) return res.status(404).json({ error: "Business not found" });
  await setTenantForRequest(req, business.id);
  const out = await awardFromExternalEventTrusted({
    businessSlug: business.slug,
    externalEventId: v.data.externalEventId,
    customerId: v.data.customerId,
    customerPhone: v.data.customerPhone
      ? normalizeEnrollmentPhone(v.data.customerPhone, business)
      : undefined,
    amount_q: v.data.amount_q ?? 0,
    visits: v.data.visits ?? 0,
    items: v.data.items ?? 0,
    meta: v.data.meta ?? {},
  });
  res.json(out);
}

async function handleBusinessRegister(req, res) {
  const v = validate(businessRegisterSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  // Optional shared secret for production; if set, require correct token
  if (config.REGISTRATION_API_KEY) {
    const tok = v.data.registration_token || req.headers["x-registration-token"];
    if (!timingSafeEqualString(String(tok ?? ""), config.REGISTRATION_API_KEY)) {
      return res.status(401).json({ error: "Invalid registration token" });
    }
  }

  // Enforce provided slug uniqueness; service will adjust if necessary.
  const existingSlug = await BusinessRepo.getPublicBySlug(v.data.slug);
  if (existingSlug) {
    return res.status(409).json({ error: "Este identificador (slug) ya está en uso" });
  }

  const { business } = await createBusinessWithOwner({
    businessName: v.data.name,
    email: v.data.email,
    phone: normalizePhone(v.data.phone),
    password: v.data.password,
    category: v.data.category ?? null,
    program_type: v.data.program_type ?? "SPEND",
    program_json: undefined,
    slug: v.data.slug,
  });

  res.status(201).json({
    id: business.id,
    slug: business.slug,
    name: business.name,
    program_type: business.program_type,
  });
}

async function handleContact(req, res) {
  const v = validate(ContactSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const ip = getRequestIp(req);
  const valid = await verifyTurnstile(v.data.turnstileToken, ip).catch(() => false);
  if (!valid) return res.status(400).json({ error: "Verificación fallida. Intenta de nuevo." });
  try {
    await sendContactEmail(v.data, { host: req.get("host") });
  } catch {
    return res
      .status(502)
      .json({ error: "No se pudo enviar el mensaje. Intenta de nuevo en unos minutos." });
  }
  res.json({ ok: true });
}

// Convenient endpoint for customer UI: returns an SVG QR for the short-lived token
async function handleCustomerQrSvg(req, res) {
  const auth = await loadAuthenticatedCustomer(req, res);
  if (!auth) return;
  const out = await issueCustomerQr({ businessId: auth.business_id, customerId: auth.customerId });
  const svg = await QRCode.toString(out.token, {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin: 2,
    scale: 10,
  });

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-QR-Exp", String(out.exp));
  res.setHeader("X-QR-JTI", String(out.jti));
  res.send(svg);
}

// --- routes --------------------------------------------------------------------

publicRoutes.get("/public/business/:slug", asyncRoute(readPublicBusiness));

publicRoutes.get("/public/keys", (req, res) => {
  // for future client-side verification if needed
  res.json({ qr_public_key_pem: config.QR_PUBLIC_KEY_PEM || null });
});

publicRoutes.post(
  "/public/business/:slug/join/request-code",
  strictRateLimit,
  rateLimitByPhone(3, 10 * 60 * 1000),
  asyncRoute(handleJoinRequestCode),
);

publicRoutes.post(
  "/public/business/:slug/login/request-code",
  strictRateLimit,
  rateLimitByPhone(3, 10 * 60 * 1000),
  asyncRoute(handleLoginRequestCode),
);

publicRoutes.post(
  "/public/staff/password-reset/request",
  strictRateLimit,
  asyncRoute(handleStaffPasswordResetRequest),
);

publicRoutes.post(
  "/public/staff/password-reset/confirm",
  strictRateLimit,
  asyncRoute(handleStaffPasswordResetConfirm),
);

publicRoutes.post(
  "/public/staff/email-change/confirm",
  strictRateLimit,
  asyncRoute(handleStaffEmailChangeConfirm),
);

publicRoutes.get("/magic/staff/:token", asyncRoute(handleStaffMagicLink));

publicRoutes.get("/magic/customer/:token", asyncRoute(handleCustomerMagicLink));

publicRoutes.post(
  "/public/business/:slug/join/verify",
  moderateRateLimit,
  rateLimitByPhone(10, 10 * 60 * 1000),
  asyncRoute(handleJoinVerify),
);

publicRoutes.post(
  "/public/business/:slug/login/verify",
  moderateRateLimit,
  rateLimitByPhone(10, 10 * 60 * 1000),
  asyncRoute(handleLoginVerify),
);

publicRoutes.post(
  "/public/customer/logout",
  requireCustomer,
  csrfProtect,
  asyncRoute(handleCustomerLogout),
);

publicRoutes.post(
  "/public/customer/qr",
  csrfProtect,
  requireCustomer,
  asyncRoute(handleCustomerQr),
);

publicRoutes.post("/public/external/award", moderateRateLimit, asyncRoute(handleExternalAward));

publicRoutes.post("/public/business/register", strictRateLimit, asyncRoute(handleBusinessRegister));

publicRoutes.post("/public/contact", strictRateLimit, asyncRoute(handleContact));

publicRoutes.get("/public/customer/qr.svg", requireCustomer, asyncRoute(handleCustomerQrSvg));
