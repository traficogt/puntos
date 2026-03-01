import { config } from "../config/index.js";
import { setCurrentTenant } from "../app/database.js";

export function tenantContext(req, res, next) {
  const bizId = req.staff?.business_id
    || req.customerAuth?.business_id;
  if (!bizId) {
    if (config.ENFORCE_TENANT_CONTEXT) {
      return res.status(400).json({ error: "Tenant context missing", code: "TENANT_REQUIRED" });
    }
    return next();
  }

  req.tenantId = String(bizId);
  req.tenant = { id: req.tenantId };

  setCurrentTenant(req.tenantId).then(() => next()).catch(next);
}

export async function setTenantForRequest(req, businessId) {
  req.tenantId = String(businessId);
  req.tenant = { id: req.tenantId };
  await setCurrentTenant(req.tenantId);
}

export function assertTenant(record, tenantId) {
  if (!record) return false;
  return String(record.business_id) === String(tenantId);
}
