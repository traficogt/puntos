import { config } from "../config/index.js";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { safeLogUrl } from "../utils/logger.js";
import { inferErrorCode as inferCodeFromMessage, isApiErrorCode } from "../utils/http-error.js";
import { isErrorLike } from "../utils/error-shape.js";

/** @typedef {import("express").NextFunction} NextFunction */

/**
 * The request fields the 404 and error handlers read. Tests call these handlers
 * with plain objects, so the contract is structural rather than Express's Request.
 * @typedef {object} ErrorHandlerRequest
 * @property {unknown} [id] pino-http request id (a string, see genReqId in src/app/server.js)
 * @property {import("node:http").IncomingHttpHeaders} headers
 * @property {{ error?: unknown, info?: unknown } | null} [log] pino-http request
 *   logger; the handler checks each method before calling it
 * @property {string} [method]
 * @property {string} [originalUrl]
 * @property {string} [url]
 */

/**
 * The response surface the 404 and error handlers use.
 * @typedef {import("../types/http.js").JsonResponder & {
 *   setHeader(name: string, value: string | string[]): unknown,
 * }} ErrorHandlerResponse
 */

/**
 * Wraps a route handler so a rejected promise reaches Express's error handler.
 * The handler's own parameters are typed where each route declares them; typing
 * them here as RequestHandler would retype every wrapped route at once, so this
 * wrapper only promises to call `fn` as a handler.
 * @param {Function} fn `(req, res, next) => unknown`
 * @returns {import("express").RequestHandler}
 */
export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * @param {{ body?: unknown }} req
 * @param {unknown} _res
 * @param {NextFunction} next
 */
export function defaultRequestBody(req, _res, next) {
  // Express 4 supplied an empty object when the JSON parser skipped a body.
  if (req.body === undefined) req.body = {};
  next();
}

/**
 * The correlation id for a request: the pino-http id, else the inbound header,
 * else a fresh UUID.
 * @param {ErrorHandlerRequest} req
 */
function requestIdOf(req) {
  return /** @type {string} */ (req.id) || req.headers["x-request-id"] || randomUUID();
}

/**
 * @param {ErrorHandlerRequest} req
 * @param {ErrorHandlerResponse} res
 */
export function notFound(req, res) {
  const requestId = requestIdOf(req);
  res.setHeader("X-Request-Id", requestId);
  res.status(404).json({ error: "No encontrado", code: "NOT_FOUND", request_id: requestId });
}

/**
 * Final error handler: maps thrown values to the `{ error, code, request_id }`
 * body, hides 5xx details in production and logs by severity.
 * @param {unknown} err
 * @param {ErrorHandlerRequest} req
 * @param {ErrorHandlerResponse} res
 * @param {NextFunction} [next] required by Express's error-handler arity; unused
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const requestId = requestIdOf(req);
  /** @type {Record<string, unknown>} the thrown value's fields, when it has any */
  const error = isErrorLike(err) ? err : {};
  // HttpError carries a numeric statusCode; other thrown values are forwarded as
  // they are, as before.
  let status = /** @type {number} */ (error.statusCode ?? error.status ?? 500);
  let msg = error.message ?? "Error interno del servidor";
  let code = inferErrorCode(err, status);
  /** @type {Array<{ field: string; message: string }> | null} */
  let details = null;

  if (err instanceof ZodError) {
    // A schema that rejected inside a handler is a client error, not a crash.
    status = 400;
    msg = "Revisa los datos enviados.";
    code = "VALIDATION_ERROR";
    details = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
  }

  if (error.type === "entity.parse.failed") {
    msg = "JSON invalido";
    code = "BAD_JSON";
  }

  // Avoid leaking internal details in production
  if (status >= 500 && config.NODE_ENV === "production") {
    msg = "Error interno del servidor";
    if (!code || code === "UNEXPECTED_ERROR") code = "INTERNAL_ERROR";
  }
  if (req.log) {
    const logError = typeof req.log.error === "function" ? req.log.error.bind(req.log) : null;
    const logInfo = typeof req.log.info === "function" ? req.log.info.bind(req.log) : logError;
    if (status >= 500) {
      if (logError) logError({ err, status, code, requestId }, "Unhandled error");
    } else {
      // 4xx errors are generally expected validation/auth/rbac outcomes.
      if (logInfo) {
        logInfo(
          {
            status,
            code,
            requestId,
            method: req.method,
            url: safeLogUrl(req.originalUrl || req.url),
          },
          "Handled client error",
        );
      }
    }
  }
  res.setHeader("X-Request-Id", requestId);
  const recoveryCaseId =
    typeof error.recoveryCaseId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(error.recoveryCaseId)
      ? error.recoveryCaseId
      : null;
  res.status(status).json({
    error: msg,
    code,
    request_id: requestId,
    ...(details ? { details } : {}),
    ...(recoveryCaseId ? { recoveryCaseId } : {}),
  });
}

/**
 * An explicit, well-formed API code on the error wins (HttpError always carries
 * one). Errors without a usable code fall back to the legacy message/status
 * inference so existing paths keep their historical codes. Internal codes such
 * as SQLSTATE values or Node system codes are never echoed.
 * @param {unknown} err
 * @param {number} status
 */
function inferErrorCode(err, status) {
  const code = isErrorLike(err) ? err.code : undefined;
  if (isApiErrorCode(code)) return code.trim();
  return inferCodeFromMessage(isErrorLike(err) ? err.message : undefined, status);
}
