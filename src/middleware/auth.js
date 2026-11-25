import { config } from "../config/index.js";
import { hasPermission } from "../utils/permissions.js";
import { setCurrentTenant, setPlatformAdmin } from "../app/database.js";
import {
  browserSessionStatus,
  getBrowserSession,
  invalidateBrowserSessionById,
  touchBrowserSessionIfNeeded,
} from "../app/services/auth-session-service.js";
import { StaffRepo } from "../app/repositories/staff-repository.js";
import { SuperAdminAuthRepo } from "../app/repositories/super-admin-auth-repository.js";
import { enforceTrialLock } from "./billing-status.js";

const RECENT_REAUTH_WINDOW_MS = config.RECENT_REAUTH_WINDOW_MS;

/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */
/** @typedef {import("express").NextFunction} NextFunction */
/** @typedef {import("../types/auth.js").AnnotatedRequestHandler} AnnotatedRequestHandler */

/**
 * Answers 401 and clears the session cookie that failed.
 * @param {Request} req
 * @param {Response} res
 * @param {string} cookieName
 * @param {string} [code]
 */
function rejectAuth(req, res, cookieName, code = "AUTH_REQUIRED") {
  if (cookieName) {
    res.clearCookie(cookieName, { path: "/" });
  }
  return res.status(401).json({ error: "No autenticado", code });
}

/**
 * Loads and validates the browser session named by `cookieName`; answers 401
 * and returns null when it is missing, expired, invalidated or of another actor.
 * @param {Request} req
 * @param {Response} res
 * @param {string} cookieName
 * @param {string} actorType STAFF | CUSTOMER | SUPER
 */
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

/** @param {Request} req @param {Response} res @param {NextFunction} next */
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
      impersonated_by: session.impersonated_by ? String(session.impersonated_by) : null,
    };
  } catch {
    return rejectAuth(req, res, config.STAFF_COOKIE_NAME, "AUTH_REQUIRED");
  }
  // Soft lock after a trial (middleware/billing-status.js): every staff mutation of a
  // locked business answers 402 TRIAL_LOCKED; reads and the exempt session, trial and
  // billing routes continue. Runs after the tenant is set so the business read uses RLS.
  try {
    if (await enforceTrialLock(req, res)) return;
    return next();
  } catch (error) {
    return next(error);
  }
}
requireStaff.__openapi = { auth: "staff" };

/** @param {Request} req @param {Response} res @param {NextFunction} next */
export async function requireCustomer(req, res, next) {
  try {
    const session = await loadActiveSession(req, res, config.CUSTOMER_COOKIE_NAME, "CUSTOMER");
    if (!session) return;
    await setCurrentTenant(String(session.business_id));
    req.customerAuth = {
      id: String(session.actor_id),
      business_id: String(session.business_id),
    };
    return next();
  } catch {
    return rejectAuth(req, res, config.CUSTOMER_COOKIE_NAME, "AUTH_REQUIRED");
  }
}
requireCustomer.__openapi = { auth: "customer" };

/** @param {Request} req @param {Response} res @param {NextFunction} next */
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

/** @param {Request} req @param {Response} res @param {NextFunction} next */
export async function requireOwner(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
  }
  if (req.staff.role !== "OWNER") {
    return res.status(403).json({ error: "Se requiere rol Dueño", code: "RBAC_ROLE_REQUIRED" });
  }
  return next();
}
requireOwner.__openapi = { staffRoles: ["OWNER"] };

/** @param {...string} roles accepted Role values */
export function requireStaffRoles(...roles) {
  /** @type {AnnotatedRequestHandler} */
  const middleware = (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    if (!roles.includes(req.staff.role))
      return res.status(403).json({ error: "Rol insuficiente", code: "RBAC_ROLE_INSUFFICIENT" });
    return next();
  };
  middleware.__openapi = { auth: "staff", staffRoles: roles };
  return middleware;
}

/** @param {string} permission a Permission value */
export function requireStaffPermission(permission) {
  /** @type {AnnotatedRequestHandler} */
  const middleware = (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    if (!hasPermission(req.staff.role, permission)) {
      return res
        .status(403)
        .json({ error: "Permiso insuficiente", code: "RBAC_PERMISSION_DENIED" });
    }
    return next();
  };
  middleware.__openapi = { auth: "staff", staffPermissions: [permission] };
  return middleware;
}

/** @param {{ requireMfaIfEnabled?: boolean }} [options] */
export function requireRecentReauth({ requireMfaIfEnabled = true } = {}) {
  /** @type {AnnotatedRequestHandler} */
  const middleware = async (req, res, next) => {
    const session = req.authSession;
    if (!session?.id) {
      return res.status(401).json({ error: "No autenticado", code: "AUTH_REQUIRED" });
    }
    const reauthAt = Date.parse(String(session.reauth_verified_at || ""));
    if (!Number.isFinite(reauthAt) || Date.now() - reauthAt > RECENT_REAUTH_WINDOW_MS) {
      return res
        .status(403)
        .json({ error: "Reautenticación requerida", code: "RECENT_REAUTH_REQUIRED" });
    }

    if (!requireMfaIfEnabled) return next();

    if (session.actor_type === "STAFF" && req.staff?.id) {
      const staff = await StaffRepo.getById(String(req.staff.id));
      if (staff?.mfa_enabled) {
        const mfaAt = Date.parse(String(session.mfa_verified_at || ""));
        if (!Number.isFinite(mfaAt) || Date.now() - mfaAt > RECENT_REAUTH_WINDOW_MS) {
          return res
            .status(403)
            .json({ error: "MFA reciente requerido", code: "RECENT_MFA_REQUIRED" });
        }
      }
    }

    if (session.actor_type === "SUPER") {
      const auth = await SuperAdminAuthRepo.getEffective().catch(() => null);
      if (auth?.mfa_enabled) {
        const mfaAt = Date.parse(String(session.mfa_verified_at || ""));
        if (!Number.isFinite(mfaAt) || Date.now() - mfaAt > RECENT_REAUTH_WINDOW_MS) {
          return res
            .status(403)
            .json({ error: "MFA reciente requerido", code: "RECENT_MFA_REQUIRED" });
        }
      }
    }

    return next();
  };
  middleware.__openapi = { recentReauth: true };
  return middleware;
}

// Note: asyncRoute lives in middleware/common.js to avoid duplicate helpers.
