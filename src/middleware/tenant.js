import { config } from "../config/index.js";
import { setCurrentTenant } from "../app/database.js";

/**
 * The request fields the tenant middleware reads and writes. Tests drive it with
 * plain objects, so the contract is structural rather than Express's Request.
 * @typedef {object} TenantRequest
 * @property {{ business_id?: string | null } | null} [staff]
 * @property {{ business_id?: string | null } | null} [customerAuth]
 * @property {string} [tenantId]
 * @property {{ id: string }} [tenant]
 */

/**
 * Derives the tenant from the authenticated actor and applies it to the
 * request's database connection.
 * @param {TenantRequest} req
 * @param {import("../types/http.js").JsonResponder} res
 * @param {import("express").NextFunction} next
 */
export function tenantContext(req, res, next) {
  const bizId = req.staff?.business_id || req.customerAuth?.business_id;
  if (!bizId) {
    if (config.ENFORCE_TENANT_CONTEXT) {
      return res
        .status(400)
        .json({ error: "Contexto de negocio requerido", code: "TENANT_REQUIRED" });
    }
    return next();
  }

  req.tenantId = String(bizId);
  req.tenant = { id: req.tenantId };

  // Rejections are already routed to next(); the settled promise is returned
  // only so every path of the handler returns.
  return setCurrentTenant(req.tenantId)
    .then(() => next())
    .catch(next);
}
tenantContext.__openapi = { tenantContext: true };

/**
 * Pins a tenant on a request that resolved it some other way (public slug, token).
 * @param {Pick<TenantRequest, "tenantId" | "tenant">} req
 * @param {string} businessId
 */
export async function setTenantForRequest(req, businessId) {
  req.tenantId = String(businessId);
  req.tenant = { id: req.tenantId };
  await setCurrentTenant(req.tenantId);
}

/**
 * Whether a tenant-scoped record belongs to the tenant.
 * @param {{ business_id?: unknown } | null | undefined} record
 * @param {string | null | undefined} tenantId
 */
export function assertTenant(record, tenantId) {
  if (!record) return false;
  return String(record.business_id) === String(tenantId);
}
