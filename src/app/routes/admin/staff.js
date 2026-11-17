import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireRecentReauth, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { StaffRepo } from "../../repositories/staff-repository.js";
import { BranchRepo } from "../../repositories/branch-repository.js";
import { dbQuery, withTransaction } from "../../database.js";
import { makeId } from "./_util.js";
import { passwordSchema } from "../../../utils/schemas.js";
import { invalidateBrowserSessionsForActor } from "../../services/auth-session-service.js";
import { hashPassword } from "../../../utils/password-hash.js";
import { assertPasswordAllowed } from "../../../utils/password-policy.js";
import { AuditRepo } from "../../repositories/audit-repository.js";
import { AuthActionTokenRepo } from "../../repositories/auth-action-token-repository.js";
import { withImpersonationMeta } from "../../../utils/impersonation.js";

export const adminStaffRoutes = Router();

export const StaffCreateSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().optional(),
  password: passwordSchema,
  role: z.enum(["CASHIER", "MANAGER"]).optional(),
  branch_id: z.guid().optional(),
  can_manage_gift_cards: z.boolean().optional()
});

export const StaffUpdateSchema = z.object({
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
  role: z.enum(["CASHIER", "MANAGER"]).optional(),
  branch_id: z.guid().nullable().optional(),
  can_manage_gift_cards: z.boolean().optional()
});

adminStaffRoutes.get(
  "/admin/staff",
  requireStaff,
  requireOwner,
  requireRecentReauth(),
  tenantContext,
  requirePlanFeature("staff_management"),
  asyncRoute(async (req, res) => {
    const rows = await StaffRepo.listByBusiness(req.tenantId);
    return res.json({ ok: true, staff: rows });
  })
);

adminStaffRoutes.post(
  "/admin/staff",
  requireStaff,
  requireOwner,
  requireRecentReauth(),
  tenantContext,
  csrfProtect,
  requirePlanFeature("staff_management"),
  asyncRoute(async (req, res) => {
    const v = validate(StaffCreateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const branchId = v.data.branch_id ?? req.staff.branch_id ?? null;
    if (branchId) {
      const branch = await BranchRepo.getById(branchId);
      if (!branch || branch.business_id !== req.tenantId) {
        return res.status(400).json({ error: "La sucursal no pertenece a tu negocio." });
      }
    }

    const existing = await StaffRepo.getByEmail(v.data.email);
    if (existing) return res.status(409).json({ error: "Email already used" });

    assertPasswordAllowed(v.data.password, {
      email: v.data.email,
      name: v.data.name,
      phone: v.data.phone
    });
    const password_hash = await hashPassword(v.data.password);

    // The account and its audit entry commit together: a failed audit write
    // leaves no account behind, so retrying cannot create a duplicate.
    const finalStaff = await withTransaction(async () => {
      const staff = await StaffRepo.create({
        id: makeId(),
        business_id: req.tenantId,
        branch_id: branchId,
        name: v.data.name,
        email: v.data.email,
        phone: v.data.phone ?? null,
        role: v.data.role ?? "CASHIER",
        password_hash
      });

      if (v.data.can_manage_gift_cards !== undefined) {
        await dbQuery(
          "UPDATE staff_users SET can_manage_gift_cards = $2 WHERE id = $1",
          [staff.id, Boolean(v.data.can_manage_gift_cards)]
        );
      }
      const created = await StaffRepo.getById(staff.id);
      await AuditRepo.log({
        id: makeId(),
        business_id: req.tenantId,
        actor_type: "STAFF",
        actor_id: req.staff.id,
        action: "staff.create",
        ip: req.ip ?? null,
        ua: req.get?.("user-agent") ?? null,
        meta: withImpersonationMeta({
          staff_id: created.id,
          role: created.role,
          branch_id: created.branch_id ?? null,
          can_manage_gift_cards: Boolean(created.can_manage_gift_cards)
        }, req.staff)
      });
      return created;
    });

    return res.json({
      ok: true,
      staff: {
        id: finalStaff.id,
        name: finalStaff.name,
        email: finalStaff.email,
        role: finalStaff.role,
        branch_id: finalStaff.branch_id,
        can_manage_gift_cards: finalStaff.can_manage_gift_cards
      }
    });
  })
);

adminStaffRoutes.patch(
  "/admin/staff/:id",
  requireStaff,
  requireOwner,
  requireRecentReauth(),
  tenantContext,
  csrfProtect,
  requirePlanFeature("staff_management"),
  asyncRoute(async (req, res) => {
    const v = validate(StaffUpdateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const target = await StaffRepo.getById(req.params.id);
    if (!target || target.business_id !== req.tenantId) {
      return res.status(404).json({ error: "Staff no encontrado" });
    }

    if (target.role === "OWNER") return res.status(400).json({ error: "No se puede editar OWNER desde este panel" });

    const fields = [];
    const params = [];
    let idx = 1;
    if (v.data.active !== undefined) {
      fields.push(`active = $${idx++}`);
      params.push(v.data.active);
    }
    if (v.data.role !== undefined) {
      fields.push(`role = $${idx++}`);
      params.push(v.data.role);
    }
    if (v.data.branch_id !== undefined) {
      if (v.data.branch_id) {
        const br = await BranchRepo.getById(v.data.branch_id);
        if (!br || br.business_id !== req.tenantId) {
          return res.status(400).json({ error: "branch_id inválido" });
        }
      }
      fields.push(`branch_id = $${idx++}`);
      params.push(v.data.branch_id);
    }
    if (v.data.password !== undefined) {
      assertPasswordAllowed(v.data.password, {
        email: target.email,
        name: target.name,
        phone: target.phone
      });
      const password_hash = await hashPassword(v.data.password);
      fields.push(`password_hash = $${idx++}`);
      params.push(password_hash);
    }
    if (v.data.can_manage_gift_cards !== undefined) {
      fields.push(`can_manage_gift_cards = $${idx++}`);
      params.push(Boolean(v.data.can_manage_gift_cards));
    }
    if (!fields.length) return res.status(400).json({ error: "Sin cambios" });

    params.push(req.params.id, req.tenantId);
    // The change, the link invalidation and the audit entry commit together.
    const updated = await withTransaction(async () => {
      await dbQuery(
        `UPDATE staff_users
         SET ${fields.join(", ")}
         WHERE id = $${idx++} AND business_id = $${idx}`,
        params
      );
      // Reset and email-change links sent earlier must not outlive a password
      // set by the owner or a deactivation.
      if (v.data.password !== undefined || v.data.active !== undefined) {
        await AuthActionTokenRepo.invalidateByActor({ actorType: "STAFF", actorId: target.id });
      }

      const row = await StaffRepo.getById(req.params.id);
      // Record what changed, never the password or its hash.
      const changes = Object.fromEntries(["active", "role", "branch_id", "can_manage_gift_cards"]
        .filter((key) => v.data[key] !== undefined)
        .map((key) => [key, { from: target[key] ?? null, to: row?.[key] ?? null }]));
      await AuditRepo.log({
        id: makeId(),
        business_id: req.tenantId,
        actor_type: "STAFF",
        actor_id: req.staff.id,
        action: "staff.update",
        ip: req.ip ?? null,
        ua: req.get?.("user-agent") ?? null,
        meta: withImpersonationMeta({ staff_id: target.id, changes, password_reset: v.data.password !== undefined }, req.staff)
      });
      return row;
    });

    if (
      v.data.active !== undefined
      || v.data.password !== undefined
      || v.data.role !== undefined
      || v.data.branch_id !== undefined
      || v.data.can_manage_gift_cards !== undefined
    ) {
      await invalidateBrowserSessionsForActor({
        actorType: "STAFF",
        actorId: target.id,
        reason: "staff_security_change"
      }).catch(() => {});
    }
    return res.json({
      ok: true,
      staff: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        branch_id: updated.branch_id,
        active: updated.active,
        can_manage_gift_cards: updated.can_manage_gift_cards
      }
    });
  })
);
