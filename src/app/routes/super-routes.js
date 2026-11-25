import { Router } from "express";
import { z } from "zod";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import {
  browserCookieMaxAge,
  signStaffToken,
  signSuperToken,
  cookieOpts,
  cookieOptsWith,
} from "../../utils/auth-token.js";
import { asyncRoute } from "../../middleware/common.js";
import { validateQuery } from "../../utils/schemas.js";
import { requireRecentReauth, requireSuperAdmin } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { strictRateLimit } from "../../middleware/rate-limit.js";
import { dbQuery } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { PlanConfigService } from "../services/plan-config-service.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { WebhookRepo } from "../repositories/webhook-repository.js";
import { PlatformSettingsRepo } from "../repositories/platform-settings-repository.js";
import { resolveWalletBroadcast } from "../services/wallet-broadcast-config.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";
import { getRequestIp } from "../../utils/request-ip.js";
import { invalidateBrowserSessionById } from "../services/auth-session-service.js";
import { verifyPassword } from "../../utils/password-hash.js";
import { SuperAdminAuthRepo } from "../repositories/super-admin-auth-repository.js";
import {
  confirmSuperEmailChange,
  confirmSuperMfaEnrollment,
  completeSuperPasswordReset,
  disableSuperMfa,
  lockdownSuperAccount,
  reauthenticateSuperSession,
  requestSuperEmailChange,
  requestSuperPasswordReset,
  startSuperMfaEnrollment,
  verifySuperMfaForLogin,
} from "../services/account-security-service.js";
import {
  CreateBusinessSchema,
  CreateBusinessUserSchema,
  createSuperBusiness,
  createSuperBusinessUser,
  LoginSchema,
  logSuperAudit,
  requireSupportedPlan,
  SetWalletBroadcastSchema,
  UpdatePlanFeaturesSchema,
  UpdatePlanSchema,
} from "./super-support.js";

/** @typedef {import("zod").infer<typeof LoginSchema>} SuperLoginInput */
/** @typedef {import("zod").infer<typeof UpdatePlanSchema>} SuperPlanUpdateInput */
/** @typedef {import("zod").infer<typeof UpdatePlanFeaturesSchema>} SuperPlanFeaturesInput */
/** @typedef {import("zod").infer<typeof CreateBusinessSchema>} SuperBusinessCreateInput */
/** @typedef {import("zod").infer<typeof CreateBusinessUserSchema>} SuperBusinessUserCreateInput */
/** @typedef {import("../../types/http-dto.js").SuperBusinessCreateResponse} SuperBusinessCreateResponse */
/** @typedef {import("../../types/http-dto.js").SuperBusinessUserCreateResponse} SuperBusinessUserCreateResponse */
/** @typedef {import("../../types/http-dto.js").SuperLoginResponse} SuperLoginResponse */
/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/**
 * @template P
 * @typedef {import("./_request-types.js").ParamsRequest<P>} ParamsRequest
 */
/**
 * @template Q
 * @typedef {import("./_request-types.js").WithValidatedQuery<Q>} WithValidatedQuery
 */
/** @typedef {import("./_request-types.js").WithAuthSession} WithAuthSession */
/** @typedef {Promise<Response | void>} HandlerResult early `return res...` or fall-through */
/**
 * Row of the `/super/businesses` listing (aggregates cast to int in SQL).
 * @typedef {Pick<import("../repositories/business-repository.js").BusinessRow,
 *   "id" | "name" | "slug" | "email" | "plan" | "created_at" | "signup_source" | "trial_status"
 *   | "billing_status" | "trial_started_at" | "trial_ends_at" | "locked_at" | "purge_after"> & { customers: number, staff: number }} SuperBusinessRow
 */

/**
 * Contracts implemented by utils/auth-token.js and the account-security services.
 * Their `= null` parameter defaults make TypeScript infer `null`-only parameters
 * (and widen `sameSite: "strict"` to `string`), so the imports are re-typed here
 * until those modules carry the JSDoc themselves. Same functions at runtime.
 * @typedef {(req?: import("express").Request | null) => import("express").CookieOptions} CookieOptsFn
 * @typedef {(req?: import("express").Request | null, overrides?: import("express").CookieOptions) => import("express").CookieOptions} CookieOptsWithFn
 * @typedef {{ ip?: string | null, ua?: string | null }} ClientMeta
 * @typedef {(input: { email: string } & ClientMeta) => Promise<unknown>} RequestSuperPasswordResetFn
 * @typedef {(input: { token: string, newPassword: string } & ClientMeta) => Promise<unknown>} CompleteSuperPasswordResetFn
 * @typedef {(input: { token: string } & ClientMeta) => Promise<unknown>} ConfirmSuperEmailChangeFn
 * @typedef {(input: { code: string, sessionId?: string | null }) => Promise<unknown>} ConfirmSuperMfaFn
 * @typedef {(input: { currentEmail: string | null | undefined, newEmail: string } & ClientMeta) => Promise<unknown>} RequestSuperEmailChangeFn
 * @typedef {(input: ClientMeta) => Promise<unknown>} LockdownSuperAccountFn
 */
const cookieOptionsFor = /** @type {CookieOptsFn} */ (/** @type {unknown} */ (cookieOpts));
const cookieOptionsWith = /** @type {CookieOptsWithFn} */ (/** @type {unknown} */ (cookieOptsWith));
const requestPasswordReset = /** @type {RequestSuperPasswordResetFn} */ (
  /** @type {unknown} */ (requestSuperPasswordReset)
);
const completePasswordReset = /** @type {CompleteSuperPasswordResetFn} */ (
  /** @type {unknown} */ (completeSuperPasswordReset)
);
const confirmEmailChange = /** @type {ConfirmSuperEmailChangeFn} */ (
  /** @type {unknown} */ (confirmSuperEmailChange)
);
const confirmMfaEnrollment = /** @type {ConfirmSuperMfaFn} */ (
  /** @type {unknown} */ (confirmSuperMfaEnrollment)
);
const requestEmailChange = /** @type {RequestSuperEmailChangeFn} */ (
  /** @type {unknown} */ (requestSuperEmailChange)
);
const lockdownAccount = /** @type {LockdownSuperAccountFn} */ (
  /** @type {unknown} */ (lockdownSuperAccount)
);

export const superRoutes = Router();

const SuperBusinessesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const SuperPostureQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});

/** @typedef {z.infer<typeof SuperBusinessesQuerySchema>} SuperBusinessesQuery */
/** @typedef {z.infer<typeof SuperPostureQuerySchema>} SuperPostureQuery */

const SuperPasswordResetRequestSchema = z.object({
  email: z.string().email(),
});

const SuperPasswordResetConfirmSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});

const SuperReauthSchema = z.object({
  password: z.string().min(1).max(128),
  mfaCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

const SuperEmailChangeSchema = z.object({
  newEmail: z.string().email(),
});

const SuperTokenConfirmSchema = z.object({
  token: z.string().min(20),
});

const SuperMfaConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

superRoutes.post(
  "/super/login",
  strictRateLimit,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload de login inválido" });
      /** @type {SuperLoginInput} */
      const payload = parsed.data;
      const auth = await SuperAdminAuthRepo.getEffective();
      if (!auth.email || (!auth.password_hash && !config.SUPER_ADMIN_PASSWORD)) {
        return res.status(403).json({ error: "Super admin no está configurado" });
      }
      if (config.NODE_ENV === "production" && !auth.password_hash) {
        return res.status(503).json({ error: "Super admin hash requerido en producción" });
      }
      const emailMatches = payload.email.toLowerCase() === String(auth.email).toLowerCase();
      const passwordMatches = auth.password_hash
        ? await verifyPassword(payload.password, auth.password_hash)
        : timingSafeEqualString(payload.password, config.SUPER_ADMIN_PASSWORD);
      if (!emailMatches || !passwordMatches) {
        await SecurityEventRepo.log({
          event_type: "super_login_failed",
          severity: "HIGH",
          route: "/api/super/login",
          method: "POST",
          ip: getRequestIp(req),
          actor_type: "SUPER_ADMIN",
          meta: { email: payload.email.toLowerCase() },
        }).catch((err) => logger.warn({ err }, "Security event write failed (super_login_failed)"));
        // Explicit code equal to what inferErrorCode("Credenciales inválidas", 401) derives, so the
        // body gains a stable `code` without changing its value (tests/unit/super-login-code.test.js).
        return res.status(401).json({ error: "Credenciales inválidas", code: "AUTH_REQUIRED" });
      }
      const mfaResult = await verifySuperMfaForLogin(payload.mfaCode);
      const token = await signSuperToken({
        email: payload.email.toLowerCase(),
        mfaVerified: Boolean(mfaResult?.mfaVerified),
      });
      res.cookie(config.SUPER_COOKIE_NAME, token, {
        ...cookieOptionsWith(req, { sameSite: "strict", path: "/" }),
        maxAge: browserCookieMaxAge("SUPER"),
      });
      /** @type {SuperLoginResponse} */
      const response = { ok: true, email: payload.email.toLowerCase() };
      res.json(response);
    },
  ),
);

superRoutes.post(
  "/public/super/password-reset/request",
  strictRateLimit,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = SuperPasswordResetRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      await requestPasswordReset({
        email: parsed.data.email,
        ip: getRequestIp(req),
        ua: req.headers["user-agent"] || null,
      });
      res.json({ ok: true });
    },
  ),
);

superRoutes.post(
  "/public/super/password-reset/confirm",
  strictRateLimit,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = SuperPasswordResetConfirmSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      await completePasswordReset({
        token: parsed.data.token,
        newPassword: parsed.data.newPassword,
        ip: getRequestIp(req),
        ua: req.headers["user-agent"] || null,
      });
      res.json({ ok: true });
    },
  ),
);

superRoutes.post(
  "/public/super/email-change/confirm",
  strictRateLimit,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = SuperTokenConfirmSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Token inválido" });
      const out = await confirmEmailChange({
        token: parsed.data.token,
        ip: getRequestIp(req),
        ua: req.headers["user-agent"] || null,
      });
      res.json(out);
    },
  ),
);

superRoutes.post(
  "/super/logout",
  requireSuperAdmin,
  csrfProtect,
  asyncRoute(
    /** @param {Request & WithAuthSession} req @param {Response} res */
    async (req, res) => {
      if (req.authSession?.id) {
        await invalidateBrowserSessionById(req.authSession.id, "logout");
      }
      res.clearCookie(config.SUPER_COOKIE_NAME, { path: "/" });
      res.json({ ok: true });
    },
  ),
);

superRoutes.post(
  "/super/security/reauth",
  requireSuperAdmin,
  csrfProtect,
  asyncRoute(
    /** @param {Request & WithAuthSession} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = SuperReauthSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      const out = await reauthenticateSuperSession({
        password: parsed.data.password,
        mfaCode: parsed.data.mfaCode,
        sessionId: req.authSession?.id,
      });
      res.json(out);
    },
  ),
);

superRoutes.post(
  "/super/security/mfa/enroll",
  requireSuperAdmin,
  csrfProtect,
  requireRecentReauth(),
  asyncRoute(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      const out = await startSuperMfaEnrollment();
      res.json({ ok: true, ...out });
    },
  ),
);

superRoutes.post(
  "/super/security/mfa/confirm",
  requireSuperAdmin,
  csrfProtect,
  requireRecentReauth({ requireMfaIfEnabled: false }),
  asyncRoute(
    /** @param {Request & WithAuthSession} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = SuperMfaConfirmSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      const out = await confirmMfaEnrollment({
        code: parsed.data.code,
        sessionId: req.authSession?.id,
      });
      res.json(out);
    },
  ),
);

superRoutes.post(
  "/super/security/mfa/disable",
  requireSuperAdmin,
  csrfProtect,
  requireRecentReauth(),
  asyncRoute(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      const out = await disableSuperMfa();
      res.json(out);
    },
  ),
);

superRoutes.post(
  "/super/security/email-change",
  requireSuperAdmin,
  csrfProtect,
  requireRecentReauth(),
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = SuperEmailChangeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      const out = await requestEmailChange({
        currentEmail: req.superAdmin?.email,
        newEmail: parsed.data.newEmail,
        ip: getRequestIp(req),
        ua: req.headers["user-agent"] || null,
      });
      res.json(out);
    },
  ),
);

superRoutes.post(
  "/super/security/lockdown",
  requireSuperAdmin,
  csrfProtect,
  requireRecentReauth(),
  asyncRoute(
    /** @param {Request} req @param {Response} res */
    async (req, res) => {
      const out = await lockdownAccount({
        ip: getRequestIp(req),
        ua: req.headers["user-agent"] || null,
      });
      res.clearCookie(config.SUPER_COOKIE_NAME, { path: "/" });
      res.json(out);
    },
  ),
);

superRoutes.get("/super/me", requireSuperAdmin, (req, res) => {
  const superAdmin = req.superAdmin;
  res.json({ ok: true, superAdmin });
});

superRoutes.get(
  "/super/businesses",
  requireSuperAdmin,
  validateQuery(SuperBusinessesQuerySchema),
  asyncRoute(
    /** @param {Request & WithValidatedQuery<SuperBusinessesQuery>} req @param {Response} res */
    async (req, res) => {
      const { limit } = req.validatedQuery;
      /** @type {{ rows: SuperBusinessRow[] }} */
      const { rows } = await dbQuery(
        `SELECT
       b.id,
       b.name,
       b.slug,
       b.email,
       b.plan,
       b.created_at,
       b.signup_source,
       b.trial_status,
       b.billing_status,
       b.trial_started_at,
       b.trial_ends_at,
       b.locked_at,
       b.purge_after,
       COUNT(DISTINCT c.id)::int AS customers,
       COUNT(DISTINCT s.id)::int AS staff
     FROM businesses b
     LEFT JOIN customers c ON c.business_id = b.id AND c.deleted_at IS NULL
     LEFT JOIN staff_users s ON s.business_id = b.id AND s.active = true
     GROUP BY b.id
     ORDER BY b.created_at DESC
     LIMIT $1`,
        [limit],
      );
      // Attach the platform-owned wallet-broadcast config (opt-in + channel policy + caps)
      // so the /super console can render a per-business toggle without a request per row.
      const walletBroadcast = await PlatformSettingsRepo.getWalletBroadcast();
      const businesses = rows.map((business) => ({
        ...business,
        wallet_broadcast: resolveWalletBroadcast(walletBroadcast, business.id),
      }));
      res.json({ ok: true, businesses });
    },
  ),
);

superRoutes.post(
  "/super/businesses",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = CreateBusinessSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      /** @type {SuperBusinessCreateInput} */
      const payload = parsed.data;
      const out = await createSuperBusiness(payload);

      const business = out.business;
      /** @type {SuperBusinessCreateResponse} */
      const response = {
        ok: true,
        business: {
          id: business.id,
          name: business.name,
          slug: business.slug,
          plan: business.plan,
        },
        ownerId: out.ownerId,
      };
      res.status(201).json(response);
    },
  ),
);

superRoutes.get(
  "/super/businesses/:businessId/users",
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const businessId = String(req.params.businessId || "");
      const business = await BusinessRepo.getById(businessId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const users = await StaffRepo.listByBusiness(businessId);
      res.json({ ok: true, users });
    },
  ),
);

superRoutes.post(
  "/super/businesses/:businessId/users",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = CreateBusinessUserSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      /** @type {SuperBusinessUserCreateInput} */
      const payload = parsed.data;
      const businessId = String(req.params.businessId || "");
      const finalUser = await createSuperBusinessUser(businessId, payload);

      /** @type {SuperBusinessUserCreateResponse} */
      const response = {
        ok: true,
        user: {
          id: finalUser.id,
          business_id: finalUser.business_id,
          branch_id: finalUser.branch_id,
          name: finalUser.name,
          email: finalUser.email,
          role: finalUser.role,
          active: finalUser.active,
          can_manage_gift_cards: finalUser.can_manage_gift_cards,
        },
      };
      res.status(201).json(response);
    },
  ),
);

superRoutes.get(
  "/super/plans",
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      const plans = await PlanConfigService.listPlans();
      res.json({ ok: true, plans });
    },
  ),
);

superRoutes.put(
  "/super/plans/:plan/features",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {ParamsRequest<{ plan: string }>} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = UpdatePlanFeaturesSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      /** @type {SuperPlanFeaturesInput} */
      const payload = parsed.data;
      const plan = requireSupportedPlan(req.params.plan);
      const features = await PlanConfigService.updatePlanFeatures(plan, payload.features);
      if (!features) return res.status(404).json({ error: "Plan no encontrado" });
      res.json({ ok: true, plan, features });
    },
  ),
);

superRoutes.put(
  "/super/businesses/:businessId/plan",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = UpdatePlanSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      /** @type {SuperPlanUpdateInput} */
      const payload = parsed.data;

      const businessId = String(req.params.businessId || "");
      const plan = requireSupportedPlan(payload.plan);

      const business = await BusinessRepo.updatePlan(businessId, plan);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const superAdmin = req.superAdmin;

      await logSuperAudit({
        action: "super.plan.update",
        businessId,
        req,
        superAdminEmail: superAdmin.email,
        meta: { plan },
      });

      res.json({
        ok: true,
        business: { id: business.id, name: business.name, plan: business.plan },
      });
    },
  ),
);

// Platform-owner-only: opt a business in/out of wallet broadcasts and set its channel
// policy + per-business caps. Merchants have no channel/broadcast knob by design; the
// shared Apple/Google wallet account is governed here so one tenant cannot endanger it.
superRoutes.put(
  "/super/businesses/:businessId/wallet-broadcast",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = SetWalletBroadcastSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
      const businessId = String(req.params.businessId || "");
      const business = await BusinessRepo.getById(businessId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const settings = await PlatformSettingsRepo.setWalletBroadcastForBusiness(
        businessId,
        parsed.data,
      );
      const superAdmin = req.superAdmin;
      await logSuperAudit({
        action: "super.wallet_broadcast.update",
        businessId,
        req,
        superAdminEmail: superAdmin.email,
        meta: parsed.data,
      });
      res.json({ ok: true, businessId, settings });
    },
  ),
);

superRoutes.post(
  "/super/impersonate/:businessId",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const businessId = req.params.businessId;
      const { rows } = await dbQuery(
        `SELECT id, business_id, role, branch_id
     FROM staff_users
     WHERE business_id = $1
       AND active = true
       AND role IN ('OWNER','MANAGER')
     ORDER BY CASE role WHEN 'OWNER' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
        [businessId],
      );
      const target = rows[0];
      if (!target)
        return res.status(404).json({ error: "No hay OWNER/MANAGER activo para este negocio" });
      const superAdmin = req.superAdmin;

      const token = await signStaffToken({
        sid: target.id,
        bid: target.business_id,
        role: target.role,
        brid: target.branch_id ?? null,
        imp: superAdmin.email,
      });
      res.cookie(config.STAFF_COOKIE_NAME, token, {
        ...cookieOptionsFor(req),
        maxAge: browserCookieMaxAge("STAFF"),
      });

      await logSuperAudit({
        action: "super.impersonate",
        businessId: target.business_id,
        req,
        superAdminEmail: superAdmin.email,
        meta: {
          as_staff_id: target.id,
          as_role: target.role,
        },
      });

      res.json({
        ok: true,
        impersonated: { staffId: target.id, role: target.role, businessId: target.business_id },
      });
    },
  ),
);

superRoutes.get(
  "/super/security/posture",
  requireSuperAdmin,
  validateQuery(SuperPostureQuerySchema),
  asyncRoute(
    /** @param {Request & WithValidatedQuery<SuperPostureQuery>} req @param {Response} res */
    async (req, res) => {
      const { hours } = req.validatedQuery;
      const [grouped, recent] = await Promise.all([
        SecurityEventRepo.countByEventType({ hours }),
        SecurityEventRepo.listRecent({ hours, limit: 30 }),
      ]);

      const byType = Object.fromEntries(grouped.map((r) => [r.event_type, Number(r.count || 0)]));
      res.json({
        ok: true,
        hours,
        counts: {
          super_login_failed: byType.super_login_failed ?? 0,
          staff_login_failed: byType.staff_login_failed ?? 0,
          csrf_denied: byType.csrf_denied ?? 0,
          qr_replay_blocked: byType.qr_replay_blocked ?? 0,
          webhook_auth_failed: byType.webhook_auth_failed ?? 0,
        },
        recent,
      });
    },
  ),
);

superRoutes.post(
  "/super/security/rotate-secrets",
  csrfProtect,
  requireSuperAdmin,
  requireRecentReauth(),
  asyncRoute(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      const [webhookRotated, externalAwardRotated] = await Promise.all([
        WebhookRepo.rotateSecretsToCurrentKey(),
        BusinessRepo.rotateExternalAwardApiKeysToCurrent(),
      ]);
      res.json({
        ok: true,
        rotated: {
          webhook_secrets: webhookRotated,
          external_award_api_keys: externalAwardRotated,
        },
      });
    },
  ),
);
