/**
 * Stable API error codes are UPPER_SNAKE_CASE identifiers (for example
 * `NOT_FOUND`, `CUSTOMER_NOT_FOUND`). Anything else attached to an error's
 * `code` property, such as PostgreSQL SQLSTATE values ("23505") or Node
 * system codes ("ECONNREFUSED", "ERR_INVALID_ARG_TYPE"), is an internal
 * detail and must never be echoed to API clients.
 */
const API_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const SYSTEM_CODE_PATTERN = /^(?:E[A-Z0-9]+|ERR_[A-Z0-9_]+)$/;

/**
 * @param {unknown} code
 * @returns {code is string}
 */
export function isApiErrorCode(code) {
  if (typeof code !== "string") return false;
  const value = code.trim();
  return API_CODE_PATTERN.test(value) && !SYSTEM_CODE_PATTERN.test(value);
}

/**
 * Legacy code inference. Older error paths relied on English (and a few
 * Spanish) message fragments to pick the API code; the mapping is preserved so
 * errors thrown without an explicit code keep yielding the same code they
 * always did. New code should pass an explicit code instead of relying on it.
 *
 * @param {unknown} message
 * @param {number} status
 * @returns {string}
 */
export function inferErrorCode(message, status) {
  const msg = String(message || "").toLowerCase();
  if (
    msg.includes("not authenticated") ||
    msg.includes("no autenticado") ||
    msg.includes("invalid token") ||
    msg.includes("token invalido")
  ) {
    return "AUTH_REQUIRED";
  }
  if (
    msg.includes("forbidden") ||
    msg.includes("insufficient permission") ||
    msg.includes("insufficient role")
  ) {
    return "FORBIDDEN";
  }
  if (
    msg.includes("validation failed") ||
    msg.includes("zod") ||
    msg.includes("invalid") ||
    msg.includes("bad request")
  ) {
    return "VALIDATION_ERROR";
  }
  if (msg.includes("not found") || msg.includes("no encontrado")) return "NOT_FOUND";
  if (msg.includes("feature") && msg.includes("plan")) return "PLAN_FEATURE_LOCKED";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400) return "BAD_REQUEST";
  if (status >= 500) return "INTERNAL_ERROR";
  return "UNEXPECTED_ERROR";
}

export class HttpError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message user-facing message (Spanish)
   * @param {string} [code] stable API error code; derived from the status (and,
   *   for backward compatibility, the message) when omitted
   */
  constructor(statusCode, message, code) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = isApiErrorCode(code) ? String(code).trim() : inferErrorCode(message, statusCode);
  }
}

/** @param {string} [message] @param {string} [code] */
export function badRequest(message = "Solicitud no válida", code) {
  return new HttpError(400, message, code);
}

/** @param {string} [message] @param {string} [code] */
export function unauthorized(message = "No autenticado", code) {
  return new HttpError(401, message, code);
}

/** @param {string} [message] @param {string} [code] */
export function forbidden(message = "No autorizado", code) {
  return new HttpError(403, message, code);
}

/** @param {string} [message] @param {string} [code] */
export function notFound(message = "No encontrado", code) {
  return new HttpError(404, message, code);
}

/** @param {string} [message] @param {string} [code] */
export function conflict(message = "Conflicto con el estado actual", code) {
  return new HttpError(409, message, code);
}

/** @param {string} [message] @param {string} [code] */
export function tooManyRequests(message = "Demasiadas solicitudes", code) {
  return new HttpError(429, message, code);
}
