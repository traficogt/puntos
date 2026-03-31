import { config } from "../config/index.js";
import { hasPermission } from "../utils/permissions.js";
import { setCurrentTenant, setPlatformAdmin } from "../app/database.js";
import {
  browserSessionStatus,
  getBrowserSession,
  invalidateBrowserSessionById,
  touchBrowserSessionIfNeeded
} from "../app/services/auth-session-service.js";
import { StaffRepo } from "../app/repositories/staff-repository.js";
import { SuperAdminAuthRepo } from "../app/repositories/super-admin-auth-repository.js";

const RECENT_REAUTH_WINDOW_MS = Number(process.env.RECENT_REAUTH_WINDOW_MS || 10 * 60 * 1000);

function rejectAuth(req, res, cookieName, code = "AUTH_REQUIRED") {
  if (cookieName) {
    res.clearCookie(cookieName, { path: "/" });
  }
  return res.status(401).json({ error: "No autenticado", code });
}

async function loadActiveSession(req, res, cookieName, actorType) {
  const token = req.cookies?.[cookieName];
  if (!token) {
    rejectAuth(req, res, cookieName, "AUTH_REQUIRED");
    return null;
  }
  const session = await getBrowserSession(token);
  const status = browserSessionStatus(session);
  if (!status.ok || String(session?.actor_type || "") !== actorType) {
    if (session?.id) {
      await invalidateBrowserSessionById(session.id, `auth_${status.reason}`).catch(() => {});
    }
    rejectAuth(req, res, cookieName, "AUTH_INVALID_SESSION");
    return null;
  }
  const touched = await touchBrowserSessionIfNeeded(session).catch(() => session);
  req.authSession = touched || session;
  return touched || session;
}

export async function requireStaff(req, res, next) {
  try {
    const session = await loadActiveSession(req, res, config.STAFF_COOKIE_NAME, "STAFF");
    if (!session) return;
    await setCurrentTenant(String(session.business_id));
    const staff = await StaffRepo.getById(String(session.actor_id));
    if (!staff || !staff.active || String(staff.business_id) !== String(session.business_id)) {
      await invalidateBrowserSessionById(session.id, "staff_inactive").catch(() => {});
      return rejectAuth(req, res, config.STAFF_COOKIE_NAME, "AUTH_REQUIRED");
    }
    req.staff = {
      id: String(staff.id),
      business_id: String(staff.business_id),
      role: String(staff.role ?? "CASHIER"),
      branch_id: staff.branch_id ? String(staff.branch_id) : null,
      impersonated_by: session.impersonated_by ? String(session.impersonated_by) : null
    };
    next();
  } catch {
    return rejectAuth(req, res, config.STAFF_COOKIE_NAME, "AUTH_REQUIRED");
  }
}
requireStaff.__openapi = { auth: "staff" };

export async function requireCustomer(req, res, next) {
  try {
    const session = await loadActiveSession(req, res, config.CUSTOMER_COOKIE_NAME, "CUSTOMER");
    if (!session) return;
    await setCurrentTenant(String(session.business_id));
    req.customerAuth = {
      id: String(session.actor_id),
      business_id: String(session.business_id)
    };
    next();
  } catch {
    return rejectAuth(req, res, config.CUSTOMER_COOKIE_NAME, "AUTH_REQUIRED");
  }
}
requireCustomer.__openapi = { auth: "customer" };

export async function requireSuperAdmin(req, res, next) {
  const cookieName = config.SUPER_COOKIE_NAME;
  try {
    const session = await loadActiveSession(req, res, cookieName, "SUPER");
    if (!session) return;
    req.superAdmin = { email: String(session.actor_email || "") };
  } catch {
    return rejectAuth(req, res, cookieName, "AUTH_REQUIRED");
  }

  try {
    // Allow platform-wide reads/writes through strict DB RLS policies.
    await setPlatformAdmin(true);
    return next();
  } catch (e) {
    return next(e);
  }
}
requireSuperAdmin.__openapi = { auth: "super" };

export async function requireOwner(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
  }
  if (req.staff.role !== "OWNER") {
    return res.status(403).json({ error: "Se requiere rol Dueño", code: "RBAC_ROLE_REQUIRED" });
  }
  next();
}
requireOwner.__openapi = { staffRoles: ["OWNER"] };

export function requireStaffRoles(...roles) {
  const middleware = (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    if (!roles.includes(req.staff.role)) return res.status(403).json({ error: "Rol insuficiente", code: "RBAC_ROLE_INSUFFICIENT" });
    next();
  };
  middleware.__openapi = { auth: "staff", staffRoles: roles };
  return middleware;
}

export function requireStaffPermission(permission) {
  const middleware = (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    if (!hasPermission(req.staff.role, permission)) {
      return res.status(403).json({ error: "Permiso insuficiente", code: "RBAC_PERMISSION_DENIED" });
    }
    next();
  };
  middleware.__openapi = { auth: "staff", staffPermissions: [permission] };
  return middleware;
}

export function requireRecentReauth({ requireMfaIfEnabled = true } = {}) {
  const middleware = async (req, res, next) => {
    const session = req.authSession;
    if (!session?.id) {
      return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    }
    const reauthAt = Date.parse(String(session.reauth_verified_at || ""));
    if (!Number.isFinite(reauthAt) || (Date.now() - reauthAt) > RECENT_REAUTH_WINDOW_MS) {
      return res.status(403).json({ error: "Reautenticación requerida", code: "RECENT_REAUTH_REQUIRED" });
    }

    if (!requireMfaIfEnabled) return next();

    if (session.actor_type === "STAFF" && req.staff?.id) {
      const staff = await StaffRepo.getById(String(req.staff.id));
      if (staff?.mfa_enabled) {
        const mfaAt = Date.parse(String(session.mfa_verified_at || ""));
        if (!Number.isFinite(mfaAt) || (Date.now() - mfaAt) > RECENT_REAUTH_WINDOW_MS) {
          return res.status(403).json({ error: "MFA reciente requerido", code: "RECENT_MFA_REQUIRED" });
        }
      }
    }

    if (session.actor_type === "SUPER") {
      const auth = await SuperAdminAuthRepo.getEffective().catch(() => null);
      if (auth?.mfa_enabled) {
        const mfaAt = Date.parse(String(session.mfa_verified_at || ""));
        if (!Number.isFinite(mfaAt) || (Date.now() - mfaAt) > RECENT_REAUTH_WINDOW_MS) {
          return res.status(403).json({ error: "MFA reciente requerido", code: "RECENT_MFA_REQUIRED" });
        }
      }
    }

    return next();
  };
  middleware.__openapi = { recentReauth: true };
  return middleware;
}

// Note: asyncRoute lives in middleware/common.js to avoid duplicate helpers.
