import { config } from "../config/index.js";
import {
  browserSessionStatus,
  createBrowserSession,
  getBrowserSession,
} from "../app/services/auth-session-service.js";

/**
 * The request fields the cookie helpers read to decide on the Secure flag; an
 * Express request satisfies it, and tests pass plain objects.
 * @typedef {object} CookieRequest
 * @property {boolean} [secure]
 * @property {string} [protocol]
 * @property {import("node:http").IncomingHttpHeaders} [headers]
 * @property {(name: string) => string | string[] | undefined} [get]
 */
/** @typedef {import("../types/auth.js").StaffTokenPayload} StaffTokenPayload */
/** @typedef {import("../types/auth.js").CustomerTokenPayload} CustomerTokenPayload */
/** @typedef {import("../types/auth.js").SuperTokenPayload} SuperTokenPayload */
/** @typedef {Partial<import("express").CookieOptions>} CookieOverrides */

/**
 * Opens a staff browser session and returns its opaque token.
 * @param {StaffTokenPayload} payload
 * @param {number} [_expiresInSeconds] kept for call-site compatibility; the
 *   session lifetime comes from APP_SESSION_* in config
 */
export async function signStaffToken(payload, _expiresInSeconds = 30 * 24 * 60 * 60) {
  const out = await createBrowserSession({
    actorType: "STAFF",
    actorId: payload.sid,
    businessId: payload.bid,
    role: payload.role ?? "CASHIER",
    branchId: payload.brid ?? null,
    impersonatedBy: payload.imp ?? null,
    reauthVerified: payload.reauthVerified ?? true,
    mfaVerified: payload.mfaVerified ?? false,
  });
  return out.token;
}

/**
 * Opens a customer browser session and returns its opaque token.
 * @param {CustomerTokenPayload} payload
 * @param {number} [_expiresInSeconds] see signStaffToken
 */
export async function signCustomerToken(payload, _expiresInSeconds = 180 * 24 * 60 * 60) {
  const out = await createBrowserSession({
    actorType: "CUSTOMER",
    actorId: payload.cid,
    businessId: payload.bid,
    meta: payload.slug ? { business_slug: payload.slug } : {},
  });
  return out.token;
}

/**
 * Opens a platform-operator browser session and returns its opaque token.
 * @param {SuperTokenPayload} payload
 * @param {number} [_expiresInSeconds] see signStaffToken
 */
export async function signSuperToken(payload, _expiresInSeconds = 7 * 24 * 60 * 60) {
  const out = await createBrowserSession({
    actorType: "SUPER",
    actorEmail: String(payload.email || "").toLowerCase(),
    reauthVerified: payload.reauthVerified ?? true,
    mfaVerified: payload.mfaVerified ?? false,
  });
  return out.token;
}

/**
 * Resolves a session token to its legacy claim shape; throws when the session
 * is missing, expired or invalidated.
 * @param {string} token
 */
export async function verifyToken(token) {
  const session = await getBrowserSession(token);
  const status = browserSessionStatus(session);
  if (!status.ok) throw new Error(`Invalid session: ${status.reason}`);
  if (session.actor_type === "STAFF") {
    return {
      typ: "staff",
      sid: session.actor_id,
      bid: session.business_id,
      role: session.role,
      brid: session.branch_id,
      imp: session.impersonated_by,
    };
  }
  if (session.actor_type === "CUSTOMER") {
    return {
      typ: "customer",
      cid: session.actor_id,
      bid: session.business_id,
    };
  }
  return {
    typ: "super",
    email: session.actor_email,
  };
}

/** @param {string} actorType STAFF | CUSTOMER | SUPER */
export function browserCookieMaxAge(actorType) {
  const normalized = String(actorType || "").toUpperCase();
  if (normalized === "SUPER") {
    return config.SUPER_SESSION_ABSOLUTE_MS;
  }
  return config.APP_SESSION_ABSOLUTE_MS;
}

/** @param {CookieRequest | null | undefined} req */
function requestIsHttps(req) {
  const forwardedProto = String(
    req?.get?.("x-forwarded-proto") || req?.headers?.["x-forwarded-proto"] || "",
  )
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (forwardedProto === "https") return true;
  if (req?.secure === true) return true;
  if (String(req?.protocol || "").toLowerCase() === "https") return true;
  return false;
}

/**
 * Base options for the session cookies.
 * @param {CookieRequest | null} [req] marks the cookie Secure when the request arrived over HTTPS
 * @returns {{ httpOnly: true, sameSite: "strict", secure: boolean, path: "/" }}
 */
export function cookieOpts(req = null) {
  const prod = config.NODE_ENV === "production";
  const securePreferred =
    prod || String(config.APP_ORIGIN || "").startsWith("https://") || requestIsHttps(req);
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: securePreferred, // set true when behind HTTPS or in prod
    path: "/",
  };
}

/**
 * @param {unknown} value
 * @returns {value is CookieRequest}
 */
function isRequestLike(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    ("headers" in value || "protocol" in value || "secure" in value),
  );
}

/**
 * Cookie options with overrides. Accepts `(req, overrides)` or just `(overrides)`.
 * @param {CookieRequest | CookieOverrides | null} [reqOrOverrides]
 * @param {CookieOverrides} [maybeOverrides]
 */
export function cookieOptsWith(reqOrOverrides = null, maybeOverrides = {}) {
  if (isRequestLike(reqOrOverrides)) {
    return { ...cookieOpts(reqOrOverrides), ...maybeOverrides };
  }
  return { ...cookieOpts(null), ...(reqOrOverrides || {}) };
}

/** @param {CookieRequest | null} [req] */
export function staffCookieOptions(req = null) {
  return cookieOptsWith(req, { maxAge: browserCookieMaxAge("STAFF") });
}

/** @param {CookieRequest | null} [req] */
export function customerCookieOptions(req = null) {
  return cookieOptsWith(req, { maxAge: browserCookieMaxAge("CUSTOMER") });
}
