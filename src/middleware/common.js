import { config } from "../config/index.js";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { safeLogUrl } from "../utils/logger.js";
import { inferErrorCode as inferCodeFromMessage, isApiErrorCode } from "../utils/http-error.js";

export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function defaultRequestBody(req, _res, next) {
  // Express 4 supplied an empty object when the JSON parser skipped a body.
  if (req.body === undefined) req.body = {};
  next();
}

export function notFound(req, res) {
  const requestId = req.id || req.headers["x-request-id"] || randomUUID();
  res.setHeader("X-Request-Id", requestId);
  res.status(404).json({ error: "No encontrado", code: "NOT_FOUND", request_id: requestId });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const requestId = req.id || req.headers["x-request-id"] || randomUUID();
  let status = err?.statusCode ?? err?.status ?? 500;
  let msg = err?.message ?? "Error interno del servidor";
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

  if (err?.type === "entity.parse.failed") {
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
    typeof err?.recoveryCaseId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(err.recoveryCaseId)
      ? err.recoveryCaseId
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
 */
function inferErrorCode(err, status) {
  if (isApiErrorCode(err?.code)) return err.code.trim();
  return inferCodeFromMessage(err?.message, status);
}
