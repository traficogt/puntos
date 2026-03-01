import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { StaffRepo } from "../../repositories/staff-repository.js";
import { BranchRepo } from "../../repositories/branch-repository.js";
import { dbQuery } from "../../database.js";
import { makeId } from "./_util.js";
import { passwordSchema } from "../../../utils/schemas.js";

export const adminStaffRoutes = Router();

const StaffCreateSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().optional(),
  password: passwordSchema,
  role: z.enum(["CASHIER", "MANAGER"]).optional(),
  branch_id: z.string().uuid().optional(),
  can_manage_gift_cards: z.boolean().optional()
});

const StaffUpdateSchema = z.object({
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
  role: z.enum(["CASHIER", "MANAGER"]).optional(),
  branch_id: z.string().uuid().nullable().optional(),
  can_manage_gift_cards: z.boolean().optional()
});

adminStaffRoutes.get(
  "/admin/staff",
  requireStaff,
  requireOwner,
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
  tenantContext,
  csrfProtect,
  requirePlanFeature("staff_management"),
  asyncRoute(async (req, res) => {
    const v = validate(StaffCreateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const existing = await StaffRepo.getByEmail(v.data.email);
    if (existing) return res.status(409).json({ error: "Email already used" });

    const password_hash = await bcrypt.hash(v.data.password, 10);

    const staff = await StaffRepo.create({
      id: makeId(),
      business_id: req.tenantId,
      branch_id: v.data.branch_id ?? req.staff.branch_id,
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
    const finalStaff = await StaffRepo.getById(staff.id);

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
      const password_hash = await bcrypt.hash(v.data.password, 10);
      fields.push(`password_hash = $${idx++}`);
      params.push(password_hash);
    }
    if (v.data.can_manage_gift_cards !== undefined) {
      fields.push(`can_manage_gift_cards = $${idx++}`);
      params.push(Boolean(v.data.can_manage_gift_cards));
    }
    if (!fields.length) return res.status(400).json({ error: "Sin cambios" });

    params.push(req.params.id, req.tenantId);
    await dbQuery(
      `UPDATE staff_users
       SET ${fields.join(", ")}
       WHERE id = $${idx++} AND business_id = $${idx}`,
      params
    );

    const updated = await StaffRepo.getById(req.params.id);
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
