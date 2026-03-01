import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "../../config/index.js";
import { signStaffToken, signSuperToken, cookieOpts, cookieOptsWith } from "../../utils/auth-token.js";
import { asyncRoute } from "../../middleware/common.js";
import { validateQuery } from "../../utils/schemas.js";
import { requireSuperAdmin } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { strictRateLimit } from "../../middleware/rate-limit.js";
import { dbQuery } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { listPlans, normalizePlan } from "../../utils/plan.js";
import { PlanConfigService } from "../services/plan-config-service.js";
import { createBusinessWithOwner } from "../services/business-service.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { BranchRepo } from "../repositories/branch-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { WebhookRepo } from "../repositories/webhook-repository.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";
import { passwordSchema } from "../../utils/schemas.js";
import { getRequestIp } from "../../utils/request-ip.js";

/** @typedef {import("zod").infer<typeof LoginSchema>} SuperLoginInput */
/** @typedef {import("zod").infer<typeof UpdatePlanSchema>} SuperPlanUpdateInput */
/** @typedef {import("zod").infer<typeof UpdatePlanFeaturesSchema>} SuperPlanFeaturesInput */
/** @typedef {import("zod").infer<typeof CreateBusinessSchema>} SuperBusinessCreateInput */
/** @typedef {import("zod").infer<typeof CreateBusinessUserSchema>} SuperBusinessUserCreateInput */
/** @typedef {import("../../types/http-dto.js").SuperBusinessCreateResponse} SuperBusinessCreateResponse */
/** @typedef {import("../../types/http-dto.js").SuperBusinessUserCreateResponse} SuperBusinessUserCreateResponse */
/** @typedef {import("../../types/http-dto.js").SuperLoginResponse} SuperLoginResponse */

export const superRoutes = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const UpdatePlanSchema = z.object({
  plan: z.string().min(3).max(40)
});

const UpdatePlanFeaturesSchema = z.object({
  features: z.record(z.boolean())
});

const CreateBusinessSchema = z.object({
  businessName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).optional(),
  password: passwordSchema,
  category: z.string().optional(),
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]).optional(),
  program_json: z.record(z.any()).optional(),
  plan: z.string().min(3).max(40).optional()
});

const CreateBusinessUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).optional(),
  password: passwordSchema,
  role: z.enum(["OWNER", "MANAGER", "CASHIER"]).optional(),
  branch_id: z.string().uuid().optional(),
  can_manage_gift_cards: z.boolean().optional(),
  allow_multi_owner: z.boolean().optional()
});

superRoutes.post("/super/login", strictRateLimit, asyncRoute(async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Payload de login inválido" });
  /** @type {SuperLoginInput} */
  const payload = parsed.data;
  if (!config.SUPER_ADMIN_EMAIL || (!config.SUPER_ADMIN_PASSWORD && !config.SUPER_ADMIN_PASSWORD_HASH)) {
    return res.status(403).json({ error: "Super admin no está configurado" });
  }
  if (config.NODE_ENV === "production" && !config.SUPER_ADMIN_PASSWORD_HASH) {
    return res.status(503).json({ error: "Super admin hash requerido en producción" });
  }
  const emailMatches = payload.email.toLowerCase() === config.SUPER_ADMIN_EMAIL.toLowerCase();
  const passwordMatches = config.SUPER_ADMIN_PASSWORD_HASH
    ? await bcrypt.compare(payload.password, config.SUPER_ADMIN_PASSWORD_HASH)
    : timingSafeEqualString(payload.password, config.SUPER_ADMIN_PASSWORD);
  if (
    !emailMatches || !passwordMatches
  ) {
    await SecurityEventRepo.log({
      event_type: "super_login_failed",
      severity: "HIGH",
      route: "/api/super/login",
      method: "POST",
      ip: getRequestIp(req),
      actor_type: "SUPER_ADMIN",
      meta: { email: payload.email.toLowerCase() }
    }).catch(() => { });
    return res.status(401).json({ error: "Credenciales inválidas" });
  }
  const token = await signSuperToken({ email: payload.email.toLowerCase() });
  res.cookie(
    config.SUPER_COOKIE_NAME,
    token,
    { ...cookieOptsWith({ sameSite: "strict", path: "/api" }), maxAge: 7 * 24 * 60 * 60 * 1000 }
  );
  /** @type {SuperLoginResponse} */
  const response = { ok: true, email: payload.email.toLowerCase() };
  res.json(response);
}));

superRoutes.post("/super/logout", csrfProtect, (req, res) => {
  res.clearCookie(config.SUPER_COOKIE_NAME, { path: "/api" });
  res.json({ ok: true });
});

superRoutes.get("/super/me", requireSuperAdmin, (req, res) => {
  const superAdmin = req.superAdmin;
  res.json({ ok: true, superAdmin });
});

superRoutes.get("/super/businesses", requireSuperAdmin, validateQuery(z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100)
})), asyncRoute(async (req, res) => {
  const { limit } = req.validatedQuery;
  const { rows } = await dbQuery(
    `SELECT
       b.id,
       b.name,
       b.slug,
       b.email,
       b.plan,
       b.created_at,
       COUNT(DISTINCT c.id)::int AS customers,
       COUNT(DISTINCT s.id)::int AS staff
     FROM businesses b
     LEFT JOIN customers c ON c.business_id = b.id AND c.deleted_at IS NULL
     LEFT JOIN staff_users s ON s.business_id = b.id AND s.active = true
     GROUP BY b.id
     ORDER BY b.created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json({ ok: true, businesses: rows });
}));

superRoutes.post("/super/businesses", csrfProtect, requireSuperAdmin, asyncRoute(async (req, res) => {
  const parsed = CreateBusinessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
  /** @type {SuperBusinessCreateInput} */
  const payload = parsed.data;

  const normalizedPlan = payload.plan ? normalizePlan(payload.plan) : null;
  const allowedPlans = listPlans().map((p) => p.plan);
  const desiredPlan = normalizedPlan && allowedPlans.includes(normalizedPlan) ? normalizedPlan : null;

  const out = await createBusinessWithOwner({
    businessName: payload.businessName,
    email: payload.email,
    phone: payload.phone ?? null,
    password: payload.password,
    category: payload.category ?? null,
    program_type: payload.program_type ?? "SPEND",
    program_json: payload.program_json ?? { points_per_q: 0.1, round: "ceil" },
    plan: desiredPlan ?? undefined,
    slug: null
  });

  const business = out.business;
  /** @type {SuperBusinessCreateResponse} */
  const response = {
    ok: true,
    business: { id: business.id, name: business.name, slug: business.slug, plan: business.plan },
    ownerId: out.ownerId
  };
  res.status(201).json(response);
}));

superRoutes.get("/super/businesses/:businessId/users", requireSuperAdmin, asyncRoute(async (req, res) => {
  const businessId = String(req.params.businessId || "");
  const business = await BusinessRepo.getById(businessId);
  if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
  const users = await StaffRepo.listByBusiness(businessId);
  res.json({ ok: true, users });
}));

superRoutes.post("/super/businesses/:businessId/users", csrfProtect, requireSuperAdmin, asyncRoute(async (req, res) => {
  const parsed = CreateBusinessUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
  /** @type {SuperBusinessUserCreateInput} */
  const payload = parsed.data;

  const businessId = String(req.params.businessId || "");
  const business = await BusinessRepo.getById(businessId);
  if (!business) return res.status(404).json({ error: "Negocio no encontrado" });

  const existing = await StaffRepo.getByEmail(payload.email);
  if (existing) return res.status(409).json({ error: "Correo ya registrado" });

  const requestedRole = payload.role ?? "MANAGER";
  if (requestedRole === "OWNER" && !payload.allow_multi_owner) {
    return res.status(400).json({ error: "Crear un OWNER adicional requiere allow_multi_owner=true (confirmación explícita)" });
  }

  let branchId = payload.branch_id || null;
  if (branchId) {
    const br = await BranchRepo.getById(branchId);
    if (!br || br.business_id !== businessId) {
      return res.status(400).json({ error: "branch_id inválido para este negocio" });
    }
  } else {
    const branches = await BranchRepo.listByBusiness(businessId);
    branchId = branches[0]?.id || null;
  }

  const password_hash = await bcrypt.hash(payload.password, 10);
  const user = await StaffRepo.create({
    id: crypto.randomUUID(),
    business_id: businessId,
    branch_id: branchId,
    name: payload.name,
    email: payload.email,
    phone: payload.phone ?? null,
    role: requestedRole,
    password_hash
  });

  if (payload.can_manage_gift_cards !== undefined || user.role === "OWNER") {
    await dbQuery(
      `UPDATE staff_users SET can_manage_gift_cards = $2 WHERE id = $1`,
      [user.id, user.role === "OWNER" ? true : Boolean(payload.can_manage_gift_cards)]
    );
  }
  const finalUser = await StaffRepo.getById(user.id);

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
      can_manage_gift_cards: finalUser.can_manage_gift_cards
    }
  };
  res.status(201).json(response);
}));

superRoutes.get("/super/plans", requireSuperAdmin, asyncRoute(async (_req, res) => {
  const plans = await PlanConfigService.listPlans();
  res.json({ ok: true, plans });
}));

superRoutes.put("/super/plans/:plan/features", csrfProtect, requireSuperAdmin, asyncRoute(async (req, res) => {
  const parsed = UpdatePlanFeaturesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
  /** @type {SuperPlanFeaturesInput} */
  const payload = parsed.data;
  const plan = normalizePlan(req.params.plan);
  const plans = listPlans().map((p) => p.plan);
  if (!plans.includes(plan)) {
    return res.status(400).json({ error: `Plan inválido. Permitidos: ${plans.join(", ")}` });
  }
  const features = await PlanConfigService.updatePlanFeatures(plan, payload.features);
  if (!features) return res.status(404).json({ error: "Plan no encontrado" });
  res.json({ ok: true, plan, features });
}));

superRoutes.put("/super/businesses/:businessId/plan", csrfProtect, requireSuperAdmin, asyncRoute(async (req, res) => {
  const parsed = UpdatePlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });
  /** @type {SuperPlanUpdateInput} */
  const payload = parsed.data;

  const businessId = String(req.params.businessId || "");
  const plan = normalizePlan(payload.plan);
  const plans = listPlans().map((p) => p.plan);
  if (!plans.includes(plan)) {
    return res.status(400).json({ error: `Plan inválido. Permitidos: ${plans.join(", ")}` });
  }

  const business = await BusinessRepo.updatePlan(businessId, plan);
  if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
  const superAdmin = req.superAdmin;

  await AuditRepo.log({
    id: crypto.randomUUID(),
    business_id: businessId,
    actor_type: "SUPER_ADMIN",
    actor_id: null,
    action: "super.plan.update",
    ip: req.ip || null,
    ua: req.headers["user-agent"] || null,
    meta: {
      super_admin_email: superAdmin.email,
      plan
    }
  }).catch(() => { });

  res.json({ ok: true, business: { id: business.id, name: business.name, plan: business.plan } });
}));

superRoutes.post("/super/impersonate/:businessId", csrfProtect, requireSuperAdmin, asyncRoute(async (req, res) => {
  const businessId = req.params.businessId;
  const { rows } = await dbQuery(
    `SELECT id, business_id, role, branch_id
     FROM staff_users
     WHERE business_id = $1
       AND active = true
       AND role IN ('OWNER','MANAGER')
     ORDER BY CASE role WHEN 'OWNER' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
    [businessId]
  );
  const target = rows[0];
  if (!target) return res.status(404).json({ error: "No hay OWNER/MANAGER activo para este negocio" });
  const superAdmin = req.superAdmin;

  const token = await signStaffToken({
    sid: target.id,
    bid: target.business_id,
    role: target.role,
    brid: target.branch_id ?? null,
    imp: superAdmin.email
  });
  res.cookie(config.STAFF_COOKIE_NAME, token, { ...cookieOpts(), maxAge: 12 * 60 * 60 * 1000 });

  await AuditRepo.log({
    id: crypto.randomUUID(),
    business_id: target.business_id,
    actor_type: "SUPER_ADMIN",
    actor_id: null,
    action: "super.impersonate",
    ip: req.ip || null,
    ua: req.headers["user-agent"] || null,
    meta: {
      super_admin_email: superAdmin.email,
      as_staff_id: target.id,
      as_role: target.role
    }
  }).catch(() => { });

  res.json({ ok: true, impersonated: { staffId: target.id, role: target.role, businessId: target.business_id } });
}));

superRoutes.get("/super/security/posture", requireSuperAdmin, validateQuery(z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24)
})), asyncRoute(async (req, res) => {
  const { hours } = req.validatedQuery;
  const [grouped, recent] = await Promise.all([
    SecurityEventRepo.countByEventType({ hours }),
    SecurityEventRepo.listRecent({ hours, limit: 30 })
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
      webhook_auth_failed: byType.webhook_auth_failed ?? 0
    },
    recent
  });
}));

superRoutes.post("/super/security/rotate-secrets", csrfProtect, requireSuperAdmin, asyncRoute(async (_req, res) => {
  const [webhookRotated, externalAwardRotated] = await Promise.all([
    WebhookRepo.rotateSecretsToCurrentKey(),
    BusinessRepo.rotateExternalAwardApiKeysToCurrent()
  ]);
  res.json({
    ok: true,
    rotated: {
      webhook_secrets: webhookRotated,
      external_award_api_keys: externalAwardRotated
    }
  });
}));
