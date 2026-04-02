function normalizePath(path) {
  const raw = String(path || "").trim() || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

function normalizeOriginHost(value) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

function hostFromOrigin(origin) {
  try {
    return normalizeOriginHost(new URL(String(origin || "")).hostname || "");
  } catch {
    return "";
  }
}

export function normalizeHostHeader(value) {
  const raw = normalizeOriginHost(value);
  if (!raw) return "";
  const withoutPort = raw.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  return withoutPort.replace(/\.$/, "");
}

function isLocalHost(host) {
  const normalized = normalizeHostHeader(host);
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized.endsWith(".localhost");
}

function isLocalOrigin(origin) {
  const host = hostFromOrigin(origin);
  return !host || isLocalHost(host);
}

/**
 * @param {{ forwardedProto?: string, protocol?: string, host?: string }} params
 */
function pickProtocol({ forwardedProto, protocol, host }) {
  const forwarded = String(forwardedProto || "").split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https" || forwarded === "http") return forwarded;
  const direct = String(protocol || "").trim().toLowerCase();
  if (direct === "https") return "https";
  if (direct === "http" && isLocalHost(host)) return "http";
  return isLocalHost(host) ? "http" : "https";
}

/**
 * @param {{ host?: string, forwardedProto?: string, protocol?: string }} params
 */
function inferOriginsFromHost({ host, forwardedProto, protocol }) {
  const normalizedHost = normalizeHostHeader(host);
  if (!normalizedHost || isLocalHost(normalizedHost)) {
    return { appOrigin: "", marketingOrigin: "" };
  }
  const scheme = pickProtocol({ forwardedProto, protocol, host });
  if (normalizedHost.startsWith("app.") && normalizedHost.length > 4) {
    return {
      appOrigin: `${scheme}://${normalizedHost}`,
      marketingOrigin: `${scheme}://${normalizedHost.slice(4)}`
    };
  }
  return {
    appOrigin: `${scheme}://app.${normalizedHost}`,
    marketingOrigin: `${scheme}://${normalizedHost}`
  };
}

/**
 * @param {{ host?: string, forwardedProto?: string, protocol?: string, appOrigin?: string, marketingOrigin?: string }} params
 */
function effectiveOriginsForRequest({ host, forwardedProto, protocol, appOrigin, marketingOrigin }) {
  const normalizedHost = normalizeHostHeader(host);
  if (!normalizedHost) return { appOrigin, marketingOrigin };

  const appHost = hostFromOrigin(appOrigin);
  const marketingHost = hostFromOrigin(marketingOrigin);
  const localConfigured = isLocalOrigin(appOrigin) || isLocalOrigin(marketingOrigin);
  const shouldInfer = !isLocalHost(normalizedHost) && (
    localConfigured
    || (!appHost && !marketingHost)
    || (normalizedHost.startsWith("app.") && normalizedHost !== appHost)
  );

  if (!shouldInfer) {
    return { appOrigin, marketingOrigin };
  }

  const inferred = inferOriginsFromHost({ host, forwardedProto, protocol });
  return {
    appOrigin: inferred.appOrigin || appOrigin,
    marketingOrigin: inferred.marketingOrigin || marketingOrigin
  };
}

export function isAppRoutePath(path) {
  const normalized = normalizePath(path);
  return normalized === "/admin"
    || normalized === "/admin.html"
    || normalized === "/admin-dashboard"
    || normalized === "/admin-dashboard.html"
    || normalized === "/staff/login"
    || normalized === "/staff-login.html"
    || normalized === "/staff"
    || normalized === "/staff.html"
    || normalized === "/c"
    || normalized === "/customer.html"
    || normalized === "/super"
    || normalized === "/super.html"
    || normalized === "/join.html"
    || normalized === "/registro.html"
    || /^\/join\/[^/]+$/i.test(normalized)
    || /^\/registro\/[^/]+$/i.test(normalized);
}

/**
 * @param {{ host?: string, path?: string, originalUrl?: string, forwardedProto?: string, protocol?: string, appOrigin?: string, marketingOrigin?: string }} params
 */
export function resolveHostSplitRedirect({ host, path, originalUrl, forwardedProto, protocol, appOrigin, marketingOrigin }) {
  const normalizedHost = normalizeHostHeader(host);
  const effectiveOrigins = effectiveOriginsForRequest({ host, forwardedProto, protocol, appOrigin, marketingOrigin });
  const appHost = hostFromOrigin(effectiveOrigins.appOrigin);
  const marketingHost = hostFromOrigin(effectiveOrigins.marketingOrigin);
  const normalizedPath = normalizePath(path);
  const requestedUrl = String(originalUrl || normalizedPath || "/");

  if (!normalizedHost || !appHost || !marketingHost) return "";

  if (normalizedHost === appHost && (normalizedPath === "/" || normalizedPath === "/index.html")) {
    return new URL("/staff/login", effectiveOrigins.appOrigin).toString();
  }

  if (normalizedHost === marketingHost && isAppRoutePath(normalizedPath)) {
    return new URL(requestedUrl, effectiveOrigins.appOrigin).toString();
  }

  return "";
}

/**
 * @param {{ host?: string, forwardedProto?: string, protocol?: string, appOrigin?: string, marketingOrigin?: string }} params
 */
export function runtimeConfigForHost({ host, forwardedProto, protocol, appOrigin, marketingOrigin }) {
  const effectiveOrigins = effectiveOriginsForRequest({ host, forwardedProto, protocol, appOrigin, marketingOrigin });
  const normalizedHost = normalizeHostHeader(host);
  const appHost = hostFromOrigin(effectiveOrigins.appOrigin);
  const isAppHost = Boolean(normalizedHost && appHost && normalizedHost === appHost);

  return {
    apiBaseUrl: "",
    publicWebOrigin: isAppHost ? effectiveOrigins.appOrigin : effectiveOrigins.marketingOrigin,
    appOrigin: effectiveOrigins.appOrigin,
    marketingOrigin: effectiveOrigins.marketingOrigin,
    shell: isAppHost ? "web-app" : "web-marketing"
  };
}
