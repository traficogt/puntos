import { config } from "../config/index.js";
import {
  browserSessionStatus,
  createBrowserSession,
  getBrowserSession
} from "../app/services/auth-session-service.js";

export async function signStaffToken(payload, _expiresInSeconds = 30 * 24 * 60 * 60) {
  const out = await createBrowserSession({
    actorType: "STAFF",
    actorId: payload.sid,
    businessId: payload.bid,
    role: payload.role ?? "CASHIER",
    branchId: payload.brid ?? null,
    impersonatedBy: payload.imp ?? null,
    reauthVerified: payload.reauthVerified ?? true,
    mfaVerified: payload.mfaVerified ?? false
  });
  return out.token;
}

export async function signCustomerToken(payload, _expiresInSeconds = 180 * 24 * 60 * 60) {
  const out = await createBrowserSession({
    actorType: "CUSTOMER",
    actorId: payload.cid,
    businessId: payload.bid,
    meta: payload.slug ? { business_slug: payload.slug } : {}
  });
  return out.token;
}

export async function signSuperToken(payload, _expiresInSeconds = 7 * 24 * 60 * 60) {
  const out = await createBrowserSession({
    actorType: "SUPER",
    actorEmail: String(payload.email || "").toLowerCase(),
    reauthVerified: payload.reauthVerified ?? true,
    mfaVerified: payload.mfaVerified ?? false
  });
  return out.token;
}

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
      imp: session.impersonated_by
    };
  }
  if (session.actor_type === "CUSTOMER") {
    return {
      typ: "customer",
      cid: session.actor_id,
      bid: session.business_id
    };
  }
  return {
    typ: "super",
    email: session.actor_email
  };
}

export function browserCookieMaxAge(actorType) {
  const normalized = String(actorType || "").toUpperCase();
  if (normalized === "SUPER") {
    return Number(process.env.SUPER_SESSION_ABSOLUTE_MS || 4 * 60 * 60 * 1000);
  }
  return Number(process.env.APP_SESSION_ABSOLUTE_MS || 8 * 60 * 60 * 1000);
}

function requestIsHttps(req) {
  const forwardedProto = String(req?.get?.("x-forwarded-proto") || req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (forwardedProto === "https") return true;
  if (req?.secure === true) return true;
  if (String(req?.protocol || "").toLowerCase() === "https") return true;
  return false;
}

export function cookieOpts(req = null) {
  const prod = config.NODE_ENV === "production";
  const securePreferred = prod
    || String(config.APP_ORIGIN || "").startsWith("https://")
    || requestIsHttps(req);
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: securePreferred, // set true when behind HTTPS or in prod
    path: "/"
  };
}

export function cookieOptsWith(reqOrOverrides = null, maybeOverrides = {}) {
  const req = (reqOrOverrides && typeof reqOrOverrides === "object" && ("headers" in reqOrOverrides || "protocol" in reqOrOverrides || "secure" in reqOrOverrides))
    ? reqOrOverrides
    : null;
  const overrides = req ? maybeOverrides : (reqOrOverrides || {});
  return {
    ...cookieOpts(req),
    ...overrides
  };
}

export function staffCookieOptions(req = null) {
  return cookieOptsWith(req, { maxAge: browserCookieMaxAge("STAFF") });
}

export function customerCookieOptions(req = null) {
  return cookieOptsWith(req, { maxAge: browserCookieMaxAge("CUSTOMER") });
}
