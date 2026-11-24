import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { browserCookieMaxAge, cookieOpts, signStaffToken } from "../../../utils/auth-token.js";
import { config } from "../../../config/index.js";
import { timingSafeEqualString } from "../../../utils/timing-safe.js";
import { createBusinessWithOwner } from "../../services/business-service.js";
import { rateLimitByPhone, strictRateLimit } from "../../../middleware/rate-limit.js";
import { passwordSchema } from "../../../utils/schemas.js";

/** @typedef {import("zod").infer<typeof SignupSchema>} SignupInput */
/** @typedef {import("../../../types/http-dto.js").AdminSignupResponse} AdminSignupResponse */
/** @typedef {import("../_request-types.js").Request} Request */
/** @typedef {import("../_request-types.js").Response} Response */

/**
 * The contract `cookieOpts` (utils/auth-token.js) implements. Its `req = null`
 * default makes TypeScript infer the parameter as `null` only and its literal
 * `sameSite: "strict"` widens to `string`, so a request cannot be passed through
 * the inferred type; the utils owner should annotate it, after which this alias can go.
 * @typedef {(req?: import("express").Request | null) => import("express").CookieOptions} CookieOptsFn
 */
const cookieOptionsFor = /** @type {CookieOptsFn} */ (/** @type {unknown} */ (cookieOpts));

export const adminSignupRoutes = Router();

const SignupSchema = z.object({
  businessName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).optional(),
  password: passwordSchema,
  category: z.string().optional(),
  program_type: z
    .enum(["SPEND", "VISIT", "ITEM", "DISCOUNT", "STAMP", "CASHBACK", "GIFT_CARD"])
    .optional(),
  program_json: z.record(z.string(), z.any()).optional(),
  captcha_token: z.string().max(500).optional(),
});

adminSignupRoutes.post(
  "/admin/signup",
  strictRateLimit,
  rateLimitByPhone(3, 10 * 60 * 1000),
  asyncRoute(
    /** @param {Request} req @param {Response} res */
    async (req, res) => {
      const v = validate(SignupSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      /** @type {SignupInput} */
      const payload = v.data;

      if (config.SIGNUP_CAPTCHA_SECRET) {
        const providedToken = String(
          req.headers["x-signup-captcha"] || req.body?.captcha_token || "",
        ).trim();
        if (!providedToken || !timingSafeEqualString(providedToken, config.SIGNUP_CAPTCHA_SECRET)) {
          return res.status(403).json({ error: "CAPTCHA verification failed" });
        }
      }

      const { business, ownerId, branchId } = await createBusinessWithOwner({
        businessName: payload.businessName,
        email: payload.email,
        phone: payload.phone ?? null,
        password: payload.password,
        category: payload.category ?? null,
        program_type: payload.program_type ?? "SPEND",
        // No silent default rule: the owner chooses a model (preset or manual) before any points are awarded.
        program_json: payload.program_json ?? {},
        slug: null,
      });

      // Auto-login owner (staff cookie)
      const token = await signStaffToken({
        sid: ownerId,
        bid: business.id,
        role: "OWNER",
        brid: branchId,
      });
      res.cookie(config.STAFF_COOKIE_NAME, token, {
        ...cookieOptionsFor(req),
        maxAge: browserCookieMaxAge("STAFF"),
      });

      /** @type {AdminSignupResponse} */
      const response = {
        ok: true,
        business: { id: business.id, slug: business.slug, name: business.name },
      };
      return res.json(response);
    },
  ),
);
