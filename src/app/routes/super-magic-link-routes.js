import { CustomerDirectoryRepo } from "../repositories/customer-directory-repository.js";
import { CustomerTestAccountSchema } from "./admin/customers.js";
import { getRequestIp } from "../../utils/request-ip.js";
import { Router } from "express";
import { config } from "../../config/index.js";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { requireSuperAdmin } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { uuidSchema, validateParams } from "../../utils/schemas.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { buildInternalMagicLink } from "../services/internal-magic-link-service.js";
import { InternalMagicLinkCreateSchema, logSuperAudit } from "./super-support.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/**
 * Handlers that answer early with `return res.status(...)...` and otherwise fall
 * through to `res.json(...)` (noImplicitReturns needs the `void` member).
 * @typedef {Promise<Response | void>} HandlerResult
 */
/**
 * @template P
 * @typedef {import("./_request-types.js").WithValidatedParams<P>} WithValidatedParams
 */

export const superMagicLinkRoutes = Router();

const BusinessParamsSchema = z.object({ businessId: uuidSchema });

/** @typedef {z.infer<typeof BusinessParamsSchema>} BusinessParams */

superMagicLinkRoutes.get(
  "/super/businesses/:businessId/staff",
  requireSuperAdmin,
  validateParams(BusinessParamsSchema),
  asyncRoute(
    /** @param {Request & WithValidatedParams<BusinessParams>} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const { businessId } = req.validatedParams;
      const business = await BusinessRepo.getById(businessId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const rows = await StaffRepo.listByBusiness(businessId);
      const allowedRoles = new Set(["OWNER", "MANAGER", "CASHIER"]);
      res.json({
        ok: true,
        rows: rows.filter(
          (row) =>
            row && row.active !== false && allowedRoles.has(String(row.role || "").toUpperCase()),
        ),
      });
    },
  ),
);

superMagicLinkRoutes.get(
  "/super/businesses/:businessId/customers",
  requireSuperAdmin,
  validateParams(BusinessParamsSchema),
  asyncRoute(
    /** @param {Request & WithValidatedParams<BusinessParams>} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const { businessId } = req.validatedParams;
      const business = await BusinessRepo.getById(businessId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const rows = await CustomerRepo.listByBusiness(businessId, 200);
      res.json({ ok: true, rows });
    },
  ),
);

// Platform-owner counterpart of PATCH /api/admin/customers/:id/test-account: PF staff mark
// their own demo phones and pilot seeds without impersonating the owner. Same repository
// method, same semantics (points untouched), audited in the business's trail.
superMagicLinkRoutes.patch(
  "/super/businesses/:businessId/customers/:customerId/test-account",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = CustomerTestAccountSchema.safeParse(req.body);
      const businessId = String(req.params.businessId || ""),
        customerId = String(req.params.customerId || "");
      if (
        !parsed.success ||
        !z.guid().safeParse(businessId).success ||
        !z.guid().safeParse(customerId).success
      )
        return res.status(400).json({ error: "Payload inválido", code: "VALIDATION_ERROR" });
      const customer = await CustomerDirectoryRepo.setTestAccount(
        {
          businessId,
          customerId,
          isTest: parsed.data.is_test,
        },
        {
          type: "SUPER_ADMIN",
          email: req.superAdmin.email,
          ip: getRequestIp(req),
          ua: req.get("user-agent") ?? null,
        },
      );
      res.set("Cache-Control", "no-store");
      res.json({ ok: true, customer });
    },
  ),
);

superMagicLinkRoutes.post(
  "/super/magic-links",
  csrfProtect,
  requireSuperAdmin,
  asyncRoute(
    /** @param {Request} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const parsed = InternalMagicLinkCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });

      const payload = parsed.data;
      const actorRepo = payload.actorType === "customer" ? CustomerRepo : StaffRepo;
      const actor = await actorRepo.getById(payload.actorId);
      if (!actor) {
        return res.status(404).json({
          error:
            payload.actorType === "customer" ? "Cliente no encontrado" : "Usuario no encontrado",
        });
      }
      if (payload.actorType === "staff" && actor.active === false) {
        return res.status(400).json({ error: "Este usuario no está activo" });
      }
      if (String(actor.business_id) !== String(payload.businessId)) {
        return res.status(400).json({ error: "El actor no pertenece a ese negocio" });
      }

      const out = await buildInternalMagicLink({
        actorType: payload.actorType,
        actor,
        target: payload.target,
        createdBy: req.superAdmin?.email || null,
        origin: config.APP_ORIGIN || config.PUBLIC_WEB_ORIGIN,
      });

      await logSuperAudit({
        action: "super.magic_link.create",
        businessId: payload.businessId,
        req,
        superAdminEmail: req.superAdmin?.email || null,
        meta: {
          actor_type: payload.actorType,
          actor_id: payload.actorId,
          business_id: payload.businessId,
          target: payload.target,
          magic_link_id: out.id,
          usage_mode: out.usageMode,
          expires_at: out.expiresAt,
        },
      });

      res.json({ ok: true, ...out });
    },
  ),
);
