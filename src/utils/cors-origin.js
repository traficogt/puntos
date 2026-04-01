function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

export function isAllowedApiOrigin(origin, allowedOrigins = [], requestOrigin = "") {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return true;

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (normalizedRequestOrigin && normalizedOrigin === normalizedRequestOrigin) {
    return true;
  }

  return allowedOrigins.map(normalizeOrigin).includes(normalizedOrigin);
}
