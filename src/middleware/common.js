import { config } from "../config/index.js";
import { randomUUID } from "node:crypto";

export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFound(req, res) {
  const requestId = req.id || req.headers["x-request-id"] || randomUUID();
  res.setHeader("X-Request-Id", requestId);
  res.status(404).json({ error: "No encontrado", code: "NOT_FOUND", request_id: requestId });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line
  const status = err?.statusCode ?? err?.status ?? 500;
  const requestId = req.id || req.headers["x-request-id"] || randomUUID();
  let msg = err?.message ?? "Error interno del servidor";
  let code = inferErrorCode(err, status);

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
            url: req.originalUrl || req.url
          },
          "Handled client error"
        );
      }
    }
  }
  res.setHeader("X-Request-Id", requestId);
  res.status(status).json({ error: msg, code, request_id: requestId });
}

function inferErrorCode(err, status) {
  if (typeof err?.code === "string" && err.code.trim()) return err.code.trim();
  const msg = String(err?.message || "").toLowerCase();
  if (msg.includes("not authenticated") || msg.includes("no autenticado") || msg.includes("invalid token") || msg.includes("token invalido")) {
    return "AUTH_REQUIRED";
  }
  if (msg.includes("forbidden") || msg.includes("insufficient permission") || msg.includes("insufficient role")) {
    return "FORBIDDEN";
  }
  if (msg.includes("validation failed") || msg.includes("zod") || msg.includes("invalid") || msg.includes("bad request")) {
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
