import crypto from "node:crypto";
import { config } from "../config/index.js";
import { SecurityEventRepo } from "../app/repositories/security-event-repository.js";
import { getRequestIp } from "../utils/request-ip.js";

const CSRF_COOKIE_NAME = "pf_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_BODY_FIELD = "csrf_token";
const CSRF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STATEFUL_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TRUSTED_ORIGINS = new Set([config.APP_ORIGIN, ...(config.CORS_ORIGINS || [])].filter(Boolean));

function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

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

function logDenied(req, method, reason) {
  const actor = actorContext(req);
  return SecurityEventRepo.log({
    event_type: "csrf_denied",
    severity: "MEDIUM",
    route: req.originalUrl || req.url,
    method,
    ip: getRequestIp(req),
    actor_type: actor.actor_type,
    actor_id: actor.actor_id,
    business_id: req.staff?.business_id || req.customerAuth?.business_id || null,
    meta: { reason }
  }).catch(() => {});
}

function setCsrfCookies(res, token) {
  const cookieOptions = {
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: CSRF_MAX_AGE_MS
  };

  res.cookie(CSRF_COOKIE_NAME, token, {
    ...cookieOptions,
    httpOnly: true
  });
  // The readable cookie is the client half of the double-submit pattern.
  res.cookie(`${CSRF_COOKIE_NAME}_readable`, token, {
    ...cookieOptions,
    httpOnly: false
  });
}

function getRequestToken(req) {
  const headerToken = req.headers[CSRF_HEADER_NAME];
  if (typeof headerToken === "string" && headerToken) {
    return headerToken;
  }

  const bodyToken = req.body?.[CSRF_BODY_FIELD];
  if (typeof bodyToken === "string" && bodyToken) {
    return bodyToken;
  }

  return null;
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

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

export function csrfInit(req, res, next) {
  if (!req.cookies[CSRF_COOKIE_NAME]) {
    const token = generateToken();
    setCsrfCookies(res, token);
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies[CSRF_COOKIE_NAME];
  }

  res.locals.csrfToken = req.csrfToken;
  next();
}

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
      hint: `Incluye el token en el header '${CSRF_HEADER_NAME}' o en el campo '${CSRF_BODY_FIELD}' del body`
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

  next();
}
csrfProtect.__openapi = { csrfRequired: true };

export function getCsrfToken(req) {
  return req.csrfToken || req.cookies[CSRF_COOKIE_NAME];
}

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
