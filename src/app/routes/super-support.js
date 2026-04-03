import { z } from "zod";
import crypto from "node:crypto";
import { dbQuery } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { BranchRepo } from "../repositories/branch-repository.js";
import { listPlans, normalizePlan } from "../../utils/plan.js";
import { passwordSchema } from "../../utils/schemas.js";
import { createBusinessWithOwner } from "../services/business-service.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";
import { hashPassword } from "../../utils/password-hash.js";
import { assertPasswordAllowed } from "../../utils/password-policy.js";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().regex(/^\d{6}$/).optional()
});

export const UpdatePlanSchema = z.object({
  plan: z.string().min(3).max(40)
});

export const UpdatePlanFeaturesSchema = z.object({
  features: z.record(z.boolean())
});

export const CreateBusinessSchema = z.object({
  businessName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).optional(),
  password: passwordSchema,
  category: z.string().optional(),
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]).optional(),
  program_json: z.record(z.any()).optional(),
  plan: z.string().min(3).max(40).optional()
});

export const CreateBusinessUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).optional(),
  password: passwordSchema,
  role: z.enum(["OWNER", "MANAGER", "CASHIER"]).optional(),
  branch_id: z.string().uuid().optional(),
  can_manage_gift_cards: z.boolean().optional(),
  allow_multi_owner: z.boolean().optional()
});

export const InternalMagicLinkCreateSchema = z.discriminatedUnion("actorType", [
  z.object({
    actorType: z.literal("staff"),
    actorId: z.string().uuid(),
    businessId: z.string().uuid(),
    target: z.enum(["staff", "admin-dashboard"])
  }),
  z.object({
    actorType: z.literal("customer"),
    actorId: z.string().uuid(),
    businessId: z.string().uuid(),
    target: z.literal("customer-wallet")
  })
]);

export function getSupportedPlans() {
  return listPlans().map((plan) => plan.plan);
}

export function resolveDesiredPlan(planInput) {
  const normalizedPlan = planInput ? normalizePlan(planInput) : null;
  return normalizedPlan && getSupportedPlans().includes(normalizedPlan) ? normalizedPlan : null;
}

export function requireSupportedPlan(planInput) {
  const normalizedPlan = normalizePlan(planInput);
  const supportedPlans = getSupportedPlans();
  if (!supportedPlans.includes(normalizedPlan)) {
    throw badRequest(`Plan inválido. Permitidos: ${supportedPlans.join(", ")}`);
  }
  return normalizedPlan;
}

export async function createSuperBusiness(payload) {
  const desiredPlan = resolveDesiredPlan(payload.plan);
  return createBusinessWithOwner({
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
}

export async function createSuperBusinessUser(businessId, payload) {
  const business = await BusinessRepo.getById(businessId);
  if (!business) throw notFound("Negocio no encontrado");

  const existing = await StaffRepo.getByEmail(payload.email);
  if (existing) throw conflict("Correo ya registrado");

  const requestedRole = payload.role ?? "MANAGER";
  if (requestedRole === "OWNER" && !payload.allow_multi_owner) {
    throw badRequest("Crear un OWNER adicional requiere allow_multi_owner=true (confirmación explícita)");
  }

  let branchId = payload.branch_id || null;
  if (branchId) {
    const branch = await BranchRepo.getById(branchId);
    if (!branch || branch.business_id !== businessId) {
      throw badRequest("branch_id inválido para este negocio");
    }
  } else {
    const branches = await BranchRepo.listByBusiness(businessId);
    branchId = branches[0]?.id || null;
  }

  assertPasswordAllowed(payload.password, {
    email: payload.email,
    name: payload.name,
    businessName: business.name,
    phone: payload.phone
  });
  const passwordHash = await hashPassword(payload.password);
  const user = await StaffRepo.create({
    id: crypto.randomUUID(),
    business_id: businessId,
    branch_id: branchId,
    name: payload.name,
    email: payload.email,
    phone: payload.phone ?? null,
    role: requestedRole,
    password_hash: passwordHash
  });

  if (payload.can_manage_gift_cards !== undefined || user.role === "OWNER") {
    await dbQuery(
      `UPDATE staff_users SET can_manage_gift_cards = $2 WHERE id = $1`,
      [user.id, user.role === "OWNER" ? true : Boolean(payload.can_manage_gift_cards)]
    );
  }

  return StaffRepo.getById(user.id);
}

export async function logSuperAudit({ action, businessId, req, superAdminEmail, meta = {} }) {
  await AuditRepo.log({
    id: crypto.randomUUID(),
    business_id: businessId,
    actor_type: "SUPER_ADMIN",
    actor_id: null,
    action,
    ip: req.ip || null,
    ua: req.headers["user-agent"] || null,
    meta: {
      super_admin_email: superAdminEmail,
      ...meta
    }
  }).catch(() => {});
}
