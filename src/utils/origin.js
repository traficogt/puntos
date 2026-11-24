const ALLOWED_CLIENT_PROTOCOLS = new Set(["http:", "https:", "capacitor:", "ionic:"]);
const SECURE_CLIENT_PROTOCOLS = new Set(["https:", "capacitor:", "ionic:"]);

/**
 * `protocol//host` of a client origin, or "" when it is not a valid origin for a
 * web or native (capacitor/ionic) client.
 * @param {unknown} value an Origin header or a client-supplied origin
 */
export function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const protocol = String(url.protocol || "").toLowerCase();
    if (!ALLOWED_CLIENT_PROTOCOLS.has(protocol)) return "";
    if (!url.host) return "";
    return `${protocol}//${String(url.host).toLowerCase()}`;
  } catch {
    return "";
  }
}

/** @param {unknown} value */
export function isValidClientOrigin(value) {
  return Boolean(normalizeOrigin(value));
}

/** @param {unknown} value */
export function isSecureClientOrigin(value) {
  const normalized = normalizeOrigin(value);
  if (!normalized) return false;
  const protocol = normalized.slice(0, normalized.indexOf(":") + 1);
  return SECURE_CLIENT_PROTOCOLS.has(protocol);
}
