import crypto from "node:crypto";
import { config } from "../config/index.js";
import { SecurityEventRepo } from "../app/repositories/security-event-repository.js";
import { getRequestIp } from "../utils/request-ip.js";
import { safeLogUrl } from "../utils/logger.js";

const CSRF_COOKIE_NAME = "pf_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_BODY_FIELD = "csrf_token";
const CSRF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STATEFUL_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TRUSTED_ORIGINS = new Set(
  [config.APP_ORIGIN, ...(config.CORS_ORIGINS || [])].filter(Boolean),
);

/** @typedef {import("express").NextFunction} NextFunction */

/**
 * The request fields the CSRF middleware reads. Tests drive it with plain
 * objects, so the contract is structural rather than Express's Request.
 * Cookie values are typed as strings: cookie-parser only yields other values
 * for `j:`-prefixed JSON cookies, which this application never issues (such a
 * token fails the length comparison and is rejected).
 * @typedef {object} CsrfRequest
 * @property {string} method
 * @property {string} [path]
 * @property {Record<string, string | undefined>} cookies
 * @property {import("node:http").IncomingHttpHeaders} headers
 * @property {unknown} [body]
 * @property {string} [protocol]
 * @property {(name: string) => string | string[] | undefined} get
 * @property {string} [originalUrl]
 * @property {string} [url]
 * @property {string} [ip]
 * @property {{ id?: string | null, business_id?: string | null } | null} [staff]
 * @property {{ id?: string | null, business_id?: string | null } | null} [customerAuth]
 * @property {unknown} [superAdmin]
 * @property {string} [csrfToken]
 */

/** @typedef {import("../types/http.js").JsonResponder} CsrfResponse */

function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/** @param {CsrfRequest} req */
function actorContext(req) {
  if (req.superAdmin) {
    return { actor_type: "SUPER_ADMIN", actor_id: null };
  }
  if (req.staff) {
    return { actor_type: "STAFF", actor_id: req.staff.id || null };
  }
  if (req.customerAuth) {
    return { actor_type: "CUSTOMER", actor_id: req.customerAuth.id || null };
  }

  return { actor_type: "ANON", actor_id: null };
}

/**
 * Records a rejected state-changing request as a security event (never throws).
 * @param {CsrfRequest} req
 * @param {string} method
 * @param {string} reason
 */
function logDenied(req, method, reason) {
  const actor = actorContext(req);
  return SecurityEventRepo.log({
    event_type: "csrf_denied",
    severity: "MEDIUM",
    route: safeLogUrl(req.originalUrl || req.url),
    method,
    ip: getRequestIp(req),
    actor_type: actor.actor_type,
    actor_id: actor.actor_id,
    business_id: req.staff?.business_id || req.customerAuth?.business_id || null,
    meta: { reason },
  }).catch(() => {});
}

/**
 * @param {Pick<import("express").Response, "cookie">} res
 * @param {string} token
 */
function setCsrfCookies(res, token) {
  /** @type {import("express").CookieOptions} */
  const cookieOptions = {
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: CSRF_MAX_AGE_MS,
  };

  res.cookie(CSRF_COOKIE_NAME, token, {
    ...cookieOptions,
    httpOnly: true,
  });
  // The readable cookie is the client half of the double-submit pattern.
  res.cookie(`${CSRF_COOKIE_NAME}_readable`, token, {
    ...cookieOptions,
    httpOnly: false,
  });
}

/** @param {CsrfRequest} req */
function getRequestToken(req) {
  const headerToken = req.headers[CSRF_HEADER_NAME];
  if (typeof headerToken === "string" && headerToken) {
    return headerToken;
  }

  const bodyToken =
    req.body && typeof req.body === "object"
      ? /** @type {Record<string, unknown>} */ (req.body)[CSRF_BODY_FIELD]
      : undefined;
  if (typeof bodyToken === "string" && bodyToken) {
    return bodyToken;
  }

  return null;
}

/** @param {unknown} value an Origin/Referer header or a composed origin */
function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

/** @param {CsrfRequest} req */
function verifyRequestOrigin(req) {
  const requestOrigin = normalizeOrigin(`${req.protocol}://${req.get("host")}`);
  const origin = normalizeOrigin(req.headers.origin);
  if (origin) {
    return origin === requestOrigin || TRUSTED_ORIGINS.has(origin)
      ? { ok: true, reason: "origin_ok" }
      : { ok: false, reason: "origin_mismatch" };
  }

  const referer = normalizeOrigin(req.headers.referer);
  if (referer) {
    return referer === requestOrigin || TRUSTED_ORIGINS.has(referer)
      ? { ok: true, reason: "referer_ok" }
      : { ok: false, reason: "referer_mismatch" };
  }

  return { ok: false, reason: "missing_origin_and_referer" };
}

/**
 * Issues the double-submit CSRF cookies when the request has none.
 * @param {CsrfRequest} req
 * @param {Pick<import("express").Response, "cookie" | "locals">} res
 * @param {NextFunction} next
 */
export function csrfInit(req, res, next) {
  // Native endpoints require explicit bearer credentials and never use cookies.
  if (/^\/api(?:\/v1)?\/mobile(?:\/|$)/.test(req.path || "")) return next();
  if (!req.cookies[CSRF_COOKIE_NAME]) {
    const token = generateToken();
    setCsrfCookies(res, token);
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies[CSRF_COOKIE_NAME];
  }

  res.locals.csrfToken = req.csrfToken;
  return next();
}

/**
 * Rejects state-changing requests whose token or origin does not match.
 * @param {CsrfRequest} req
 * @param {CsrfResponse} res
 * @param {NextFunction} next
 */
export function csrfProtect(req, res, next) {
  const method = req.method.toUpperCase();
  if (!STATEFUL_METHODS.has(method)) {
    return next();
  }

  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  if (!cookieToken) {
    logDenied(req, method, "missing_cookie_token");
    return res.status(403).json({ error: "Falta token CSRF" });
  }

  const requestToken = getRequestToken(req);
  if (!requestToken) {
    logDenied(req, method, "missing_request_token");
    return res.status(403).json({
      error: "Token CSRF requerido",
      hint: `Incluye el token en el header '${CSRF_HEADER_NAME}' o en el campo '${CSRF_BODY_FIELD}' del body`,
    });
  }

  const originCheck = verifyRequestOrigin(req);
  if (!originCheck.ok) {
    logDenied(req, method, originCheck.reason);
    return res.status(403).json({ error: "Origen de solicitud inválido" });
  }

  if (cookieToken.length !== requestToken.length) {
    logDenied(req, method, "token_length_mismatch");
    return res.status(403).json({ error: "Token CSRF inválido" });
  }

  if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(requestToken))) {
    logDenied(req, method, "token_mismatch");
    return res.status(403).json({ error: "Token CSRF inválido" });
  }

  return next();
}
csrfProtect.__openapi = { csrfRequired: true };

/** @param {Pick<CsrfRequest, "csrfToken" | "cookies">} req */
export function getCsrfToken(req) {
  return req.csrfToken || req.cookies[CSRF_COOKIE_NAME];
}

/**
 * Adds `csrfToken` to every JSON object body the response sends.
 * @param {Pick<CsrfRequest, "csrfToken" | "cookies">} req
 * @param {Pick<import("express").Response, "json">} res
 * @param {NextFunction} next
 */
export function addCsrfToResponse(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function jsonWithCsrf(data) {
    if (typeof data === "object" && data !== null) {
      data.csrfToken = getCsrfToken(req);
    }
    return originalJson(data);
  };
  next();
}
