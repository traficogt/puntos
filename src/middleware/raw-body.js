// Raw request bodies for provider webhooks. The Svix signature covers the exact bytes
// Recurrente sent, so these paths are parsed by express.raw() ahead of express.json()
// (src/app/server.js) and the text is kept on `req.rawBody`; the route verifies the
// signature first and parses JSON afterwards. `req.body` becomes an empty object so the
// body-size and complexity middleware downstream see nothing to inspect.
import express from "express";

/** Paths (both API prefixes) whose bodies arrive raw. */
export const RAW_BODY_PATHS = Object.freeze([
  "/api/public/billing/webhooks",
  "/api/v1/public/billing/webhooks",
]);

/**
 * @param {{ body?: unknown, rawBody?: string }} req
 * @param {unknown} _res
 * @param {import("express").NextFunction} next
 */
export function captureRawBody(req, _res, next) {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body.toString("utf8");
    req.body = {};
  }
  next();
}

/**
 * Mounts the raw parser and the capture step on the webhook paths. Call before
 * `express.json()` so the JSON parser skips bodies that were already read.
 * @param {import("express").Express} app
 * @param {{ limit?: string }} [options]
 */
export function mountRawBody(app, { limit = "1mb" } = {}) {
  app.use([...RAW_BODY_PATHS], express.raw({ type: () => true, limit }), captureRawBody);
}
