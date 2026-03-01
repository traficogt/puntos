import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { cookieOpts, signStaffToken } from "../../../utils/auth-token.js";
import { config } from "../../../config/index.js";
import { createBusinessWithOwner } from "../../services/business-service.js";
import { rateLimitByPhone, strictRateLimit } from "../../../middleware/rate-limit.js";
import { passwordSchema } from "../../../utils/schemas.js";

/** @typedef {import("zod").infer<typeof SignupSchema>} SignupInput */
/** @typedef {import("../../../types/http-dto.js").AdminSignupResponse} AdminSignupResponse */

export const adminSignupRoutes = Router();

const SignupSchema = z.object({
  businessName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).optional(),
  password: passwordSchema,
  category: z.string().optional(),
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]).optional(),
  program_json: z.record(z.any()).optional(),
  captcha_token: z.string().max(500).optional()
});

adminSignupRoutes.post(
  "/admin/signup",
  strictRateLimit,
  rateLimitByPhone(3, 10 * 60 * 1000),
  asyncRoute(async (req, res) => {
    const v = validate(SignupSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    /** @type {SignupInput} */
    const payload = v.data;

    if (config.SIGNUP_CAPTCHA_SECRET) {
      const providedToken = String(req.headers["x-signup-captcha"] || req.body?.captcha_token || "").trim();
      if (!providedToken || providedToken !== config.SIGNUP_CAPTCHA_SECRET) {
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
      program_json: payload.program_json ?? { points_per_q: 0.1, round: "ceil" },
      slug: null
    });

    // Auto-login owner (staff cookie)
    const token = await signStaffToken({ sid: ownerId, bid: business.id, role: "OWNER", brid: branchId });
    res.cookie(config.STAFF_COOKIE_NAME, token, { ...cookieOpts(), maxAge: 30 * 24 * 60 * 60 * 1000 });

    /** @type {AdminSignupResponse} */
    const response = { ok: true, business: { id: business.id, slug: business.slug, name: business.name } };
    return res.json(response);
  })
);
