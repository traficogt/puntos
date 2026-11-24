/** @param {string | undefined} value an Origin header or configured origin */
function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

/**
 * Whether a browser Origin may call the API: same-origin requests and the
 * configured CORS_ORIGINS are allowed; a missing Origin is not a CORS request.
 * @param {string | undefined} origin the request's Origin header
 * @param {readonly string[]} [allowedOrigins] config.CORS_ORIGINS
 * @param {string} [requestOrigin] the origin the request was served on
 */
export function isAllowedApiOrigin(origin, allowedOrigins = [], requestOrigin = "") {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return true;

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (normalizedRequestOrigin && normalizedOrigin === normalizedRequestOrigin) {
    return true;
  }

  return allowedOrigins.map(normalizeOrigin).includes(normalizedOrigin);
}
