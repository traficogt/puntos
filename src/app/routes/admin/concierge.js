import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { moderateRateLimit } from "../../../middleware/rate-limit.js";
import { validate } from "../../../utils/validation.js";
import { withImpersonationMeta } from "../../../utils/impersonation.js";
import { AuditRepo } from "../../repositories/audit-repository.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { StaffRepo } from "../../repositories/staff-repository.js";
import { sendContactEmail } from "../../services/contact-service.js";
import { makeId } from "./_util.js";

const ConciergeRequestSchema = z.object({
  phone: z.string().trim().min(7).max(25),
  business_type: z.string().trim().min(1).max(60),
  preferred_time: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(1000).optional().default("")
}).strict();

/**
 * Done-for-you onboarding: the owner asks PuntosFieles to configure the program for them,
 * from inside the authenticated panel. The server supplies WHO is asking (business name,
 * slug, plan, owner e-mail) so the request never relies on client-supplied identity, and the
 * message is delivered through the existing contact mailer (log-only when CONTACT_TO is unset).
 * @param {{ sendEmail?: typeof sendContactEmail }} [deps]
 */
export function createConciergeRoutes({ sendEmail = sendContactEmail } = {}) {
  const router = Router();
  router.post(
    "/admin/concierge-request",
    requireStaff,
    requireOwner,
    tenantContext,
    moderateRateLimit,
    csrfProtect,
    asyncRoute(async (req, res) => {
      const v = validate(ConciergeRequestSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const business = await BusinessRepo.getById(req.tenantId);
      if (!business) return res.status(404).json({ error: "Business not found" });
      // The session only carries id/role; the owner e-mail lives on the staff row.
      const staffRow = await StaffRepo.getById(req.staff.id).catch(() => null);
      const ownerEmail = String(staffRow?.email || "").trim();
      const contact = ownerEmail ? `${v.data.phone} · ${ownerEmail}` : v.data.phone;
      const message = [
        `Tipo de negocio: ${v.data.business_type}`,
        `Horario preferido: ${v.data.preferred_time || "sin preferencia"}`,
        `Plan actual: ${business.plan || "desconocido"} · slug: ${business.slug || "-"} · id: ${business.id}`,
        "",
        v.data.note || "(sin nota)"
      ].join("\n");
      await sendEmail(
        { name: ownerEmail || business.name, business: business.name, contact, message, subject: `Configuración acompañada — ${business.name}` },
        { host: req.get("host") }
      );
      await AuditRepo.log({
        id: makeId(), business_id: req.tenantId, actor_type: "STAFF", actor_id: req.staff.id,
        action: "concierge.request", ip: null, ua: null,
        meta: withImpersonationMeta({ business_type: v.data.business_type, preferred_time: v.data.preferred_time }, req.staff)
      }).catch(() => {});
      return res.json({ ok: true });
    })
  );
  return router;
}

export const adminConciergeRoutes = createConciergeRoutes();
