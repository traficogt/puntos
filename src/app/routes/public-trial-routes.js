import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { moderateRateLimit, rateLimitByIp, rateLimitByPhone } from "../../middleware/rate-limit.js";
import { validate } from "../../utils/validation.js";
import { passwordSchema } from "../../utils/schemas.js";
import { browserCookieMaxAge, cookieOpts, signStaffToken } from "../../utils/auth-token.js";
import { config } from "../../config/index.js";
import { getRequestIp } from "../../utils/request-ip.js";
import { trialSignupService } from "../services/trial-signup-service.js";
import { PLAN_DISPLAY_NAMES, TRIAL_PLAN } from "../services/public-plan-service.js";
import { planDisplayName } from "../services/trial-entitlement.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("../../types/http-dto.js").PublicTrialSignupResponse} PublicTrialSignupResponse */
/**
 * See admin/signup.js: `cookieOpts` infers a `null`-only parameter until utils annotates it.
 * @typedef {(req?: import("express").Request | null) => import("express").CookieOptions} CookieOptsFn
 */
const cookieOptionsFor = /** @type {CookieOptsFn} */ (/** @type {unknown} */ (cookieOpts));

const phoneField = z.string().min(8).max(30);
const turnstileField = z.string().min(1).max(4096);
// `website` is a honeypot: humans never see the field, bots fill it.
const honeypot = z.string().max(200).optional();

export const TrialRequestCodeSchema = z.object({
  phone: phoneField,
  turnstileToken: turnstileField,
  website: honeypot,
});
export const TrialVerifySchema = z.object({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/),
});
export const TrialSignupSchema = z.object({
  grant: z.string().length(43),
  businessName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  category: z.string().max(50).optional(),
  turnstileToken: turnstileField,
  plan: z.enum(["EMPRENDEDOR", "NEGOCIO", "EMPRESA"]).optional(),
  website: honeypot,
});

/** @typedef {z.infer<typeof TrialSignupSchema>} TrialSignupInput */

// Strict per-IP budget (same window as strictRateLimit) in its own bucket: a visitor who
// re-requests a code or retries the final step must not exhaust the login endpoints' budget.
const trialRateLimit = rateLimitByIp(10, 15 * 60 * 1000, {
  keyPrefix: "ip:trial:",
  message: "Too many attempts.",
});

const defaults = {
  service: trialSignupService,
  requestLimit: trialRateLimit,
  verifyLimit: moderateRateLimit,
  signupLimit: trialRateLimit,
  requestPhoneLimit: rateLimitByPhone(3, 10 * 60 * 1000, { keyPrefix: "phone:trial:" }),
  verifyPhoneLimit: rateLimitByPhone(8, 10 * 60 * 1000, { keyPrefix: "phone:trial-verify:" }),
  signStaffToken,
  config,
};

/** @param {Partial<typeof defaults>} [overrides] */
export function createPublicTrialRoutes(overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const router = Router();
  router.use("/public/trial", (_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    next();
  });

  // What the /prueba/ page needs before the first request: the Turnstile site key, the
  // trial terms and whether signup is offered at all (production requires Turnstile).
  router.get(
    "/public/trial/config",
    /** @param {Request} _req @param {Response} res */
    (_req, res) => {
      res.json({
        ok: true,
        enabled: deps.service.available(),
        turnstile_site_key: deps.config.CONTACT_TURNSTILE_SITE_KEY || null,
        // Aliases in the shape the support form config uses, which the signup page reads.
        siteKey: deps.config.CONTACT_TURNSTILE_SITE_KEY || "",
        challengeRequired: Boolean(deps.config.CONTACT_TURNSTILE_SECRET),
        trial_days: deps.config.TRIAL_DAYS,
        allowed_dial_codes: deps.config.TRIAL_ALLOWED_DIAL_CODES,
        plan: { id: TRIAL_PLAN, name: PLAN_DISPLAY_NAMES[TRIAL_PLAN] },
        otp: { code_length: 6, expires_minutes: 10, resend_seconds: 60 },
        next_url: "/negocio/",
      });
    },
  );

  router.post(
    "/public/trial/request-code",
    deps.requestLimit,
    deps.requestPhoneLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const v = validate(TrialRequestCodeSchema, req.body);
        if (!v.ok) return res.status(400).json({ error: v.error, code: "VALIDATION_ERROR" });
        if (v.data.website) return res.json({ ok: true });
        const out = await deps.service.requestCode({
          phone: v.data.phone,
          turnstileToken: v.data.turnstileToken,
          ip: getRequestIp(req) || null,
        });
        return res.json(out);
      },
    ),
  );

  router.post(
    "/public/trial/verify",
    deps.verifyLimit,
    deps.verifyPhoneLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const v = validate(TrialVerifySchema, req.body);
        if (!v.ok) return res.status(400).json({ error: v.error, code: "VALIDATION_ERROR" });
        return res.json(await deps.service.verify({ phone: v.data.phone, code: v.data.code }));
      },
    ),
  );

  router.post(
    "/public/trial/signup",
    deps.signupLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const v = validate(TrialSignupSchema, req.body);
        if (!v.ok) return res.status(400).json({ error: v.error, code: "VALIDATION_ERROR" });
        /** @type {TrialSignupInput} */
        const payload = v.data;
        if (payload.website)
          return res
            .status(400)
            .json({ error: "Verificación fallida. Intenta de nuevo.", code: "TURNSTILE_FAILED" });
        const out = await deps.service.signup({
          grant: payload.grant,
          businessName: payload.businessName,
          email: payload.email,
          password: payload.password,
          category: payload.category ?? null,
          turnstileToken: payload.turnstileToken,
          ip: getRequestIp(req) || null,
          plan: payload.plan ?? null,
        });

        // Auto-login the owner exactly like /api/admin/signup does.
        const token = await deps.signStaffToken({
          sid: out.ownerId,
          bid: out.business.id,
          role: "OWNER",
          brid: out.branchId,
        });
        res.cookie(deps.config.STAFF_COOKIE_NAME, token, {
          ...cookieOptionsFor(req),
          maxAge: browserCookieMaxAge("STAFF"),
        });

        const origin = String(deps.config.APP_ORIGIN).replace(/\/+$/, "");
        /** @type {PublicTrialSignupResponse} */
        const response = {
          ok: true,
          business: {
            id: out.business.id,
            slug: out.business.slug,
            name: out.business.name,
            plan: out.business.plan,
            plan_name: planDisplayName(out.business.plan),
          },
          trial: {
            status: out.trial.status,
            days_left: out.trial.days_left,
            started_at: out.trial.started_at,
            ends_at: out.trial.ends_at,
          },
          intended_plan: out.intended_plan,
          join_url: `${origin}/registro/${out.business.slug}`,
          next_url: "/negocio/",
        };
        return res.status(201).json(response);
      },
    ),
  );
  return router;
}

export const publicTrialRoutes = createPublicTrialRoutes();
