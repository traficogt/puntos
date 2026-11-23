import path from "node:path";

/** Cache-Control for static files requested with a content-derived `?v=` version. */
export const VERSIONED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Whether the request URL carries a non-empty `?v=` query parameter.
 * @param {{ originalUrl?: string, url?: string } | undefined} req
 */
export function hasVersionQuery(req) {
  const target = req?.originalUrl || req?.url || "";
  const queryStart = target.indexOf("?");
  if (queryStart < 0) return false;
  const version = new URLSearchParams(target.slice(queryStart + 1)).get("v");
  return typeof version === "string" && version.length > 0;
}

/**
 * `setHeaders` hook for the express.static mount of public/.
 *
 * Pages reference their assets as `/asset.ext?v=<8 hex digits of the file's SHA-256>`
 * (src/scripts/build-asset-versions.mjs), so a versioned URL names exactly one content and
 * may be cached for a year without revalidation. Everything else keeps serve-static's
 * default `public, max-age=0`: documents (.html, including extensionless matches), requests
 * without `?v=`, and the worker (`/sw.js`, whose route already set `no-store`). A
 * Cache-Control header set earlier in the chain is never overridden. express.static only
 * reaches this hook for files that exist under public/.
 * @param {import("express").Response} res
 * @param {string} filePath Absolute path of the file express.static is about to send.
 */
export function setStaticCacheHeaders(res, filePath) {
  if (res.getHeader("Cache-Control")) return;
  if (!hasVersionQuery(res.req)) return;
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html" || extension === ".htm") return;
  if (path.basename(filePath) === "sw.js") return;
  res.setHeader("Cache-Control", VERSIONED_ASSET_CACHE_CONTROL);
}
