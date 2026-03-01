import { config } from "../config/index.js";
import { verifyToken } from "../utils/auth-token.js";
import { hasPermission } from "../utils/permissions.js";
import { setPlatformAdmin } from "../app/database.js";
export async function requireStaff(req, res, next) {
  try {
    const token = req.cookies?.[config.STAFF_COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    const payload = await verifyToken(token);
    if (payload.typ !== "staff") return res.status(401).json({ error: "Token inválido", code: "AUTH_INVALID_TOKEN" });
    req.staff = {
      id: String(payload.sid),
      business_id: String(payload.bid),
      role: String(payload.role ?? "CASHIER"),
      branch_id: payload.brid ? String(payload.brid) : null,
      impersonated_by: payload.imp ? String(payload.imp) : null
    };
    next();
  } catch {
    return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
  }
}

export async function requireCustomer(req, res, next) {
  try {
    const token = req.cookies?.[config.CUSTOMER_COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    const payload = await verifyToken(token);
    if (payload.typ !== "customer") return res.status(401).json({ error: "Token inválido", code: "AUTH_INVALID_TOKEN" });
    req.customerAuth = {
      id: String(payload.cid),
      business_id: String(payload.bid)
    };
    next();
  } catch {
    return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
  }
}

export async function requireSuperAdmin(req, res, next) {
  const token = req.cookies?.[config.SUPER_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
  try {
    const payload = await verifyToken(token);
    if (payload.typ !== "super") return res.status(401).json({ error: "Token inválido", code: "AUTH_INVALID_TOKEN" });
    req.superAdmin = { email: String(payload.email || "") };
  } catch {
    return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
  }

  try {
    // Allow platform-wide reads/writes through strict DB RLS policies.
    await setPlatformAdmin(true);
    return next();
  } catch (e) {
    return next(e);
  }
}

export async function requireOwner(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
  }
  if (req.staff.role !== "OWNER") {
    return res.status(403).json({ error: "Se requiere rol Dueño", code: "RBAC_ROLE_REQUIRED" });
  }
  next();
}

export function requireStaffRoles(...roles) {
  return (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    if (!roles.includes(req.staff.role)) return res.status(403).json({ error: "Rol insuficiente", code: "RBAC_ROLE_INSUFFICIENT" });
    next();
  };
}

export function requireStaffPermission(permission) {
  return (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    if (!hasPermission(req.staff.role, permission)) {
      return res.status(403).json({ error: "Permiso insuficiente", code: "RBAC_PERMISSION_DENIED" });
    }
    next();
  };
}

// Note: asyncRoute lives in middleware/common.js to avoid duplicate helpers.
