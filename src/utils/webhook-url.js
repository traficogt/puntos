import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE_V4_RANGES = [
  { from: [10, 0, 0, 0], to: [10, 255, 255, 255] },
  { from: [127, 0, 0, 0], to: [127, 255, 255, 255] },
  { from: [169, 254, 0, 0], to: [169, 254, 255, 255] },
  { from: [172, 16, 0, 0], to: [172, 31, 255, 255] },
  { from: [192, 168, 0, 0], to: [192, 168, 255, 255] },
  { from: [100, 64, 0, 0], to: [100, 127, 255, 255] }, // CGNAT
  { from: [0, 0, 0, 0], to: [0, 255, 255, 255] }
];

function v4ToNum(ip) {
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inRangeV4(ip, r) {
  const n = v4ToNum(ip);
  if (n === null) return false;
  const from = ((r.from[0] << 24) >>> 0) + (r.from[1] << 16) + (r.from[2] << 8) + r.from[3];
  const to = ((r.to[0] << 24) >>> 0) + (r.to[1] << 16) + (r.to[2] << 8) + r.to[3];
  return n >= from && n <= to;
}

function isPrivateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    return PRIVATE_V4_RANGES.some((r) => inRangeV4(ip, r));
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    // localhost / unspecified
    if (lower === "::1" || lower === "::" || lower === "0:0:0:0:0:0:0:1") return true;
    // Unique local (fc00::/7) and link-local (fe80::/10)
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    return false;
  }
  return true;
}

function hostMatchesAllowlist(host, allowlist) {
  if (!allowlist || allowlist.length === 0) return true;
  const h = host.toLowerCase();
  return allowlist.some((entry) => {
    const e = String(entry).trim().toLowerCase();
    if (!e) return false;
    if (h === e) return true;
    return h.endsWith("." + e);
  });
}

/**
 * Validates a webhook URL and blocks SSRF to localhost/private IP ranges.
 * Resolves DNS and checks all returned addresses.
 * @param {string} urlStr
 * @param {{ requireHttps?: boolean, allowlist?: string[] }} opts
 * @returns {Promise<URL>}
 */
/**
 * @param {string} urlStr
 * @param {{ requireHttps?: boolean, allowlist?: string[], lookup?: any }} opts
 */
export async function validateWebhookUrl(urlStr, opts = {}) {
  const { url } = await resolveWebhookTarget(urlStr, opts);
  return url;
}

/**
 * Resolves and validates the destination IP so callers can pin outbound requests
 * to the checked address instead of re-resolving later.
 *
 * @param {string} urlStr
 * @param {{ requireHttps?: boolean, allowlist?: string[], lookup?: any }} opts
 * @returns {Promise<{ url: URL, resolvedAddress: string|null, resolvedFamily: number|null }>}
 */
export async function resolveWebhookTarget(urlStr, opts = {}) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }

  const requireHttps = opts.requireHttps !== false;
  if (requireHttps && url.protocol !== "https:") {
    throw new Error("Webhook URL must use https://");
  }

  // block credentials in URL
  if (url.username || url.password) {
    throw new Error("Webhook URL must not include credentials");
  }

  const host = url.hostname;
  if (!host) throw new Error("Invalid host");
  if (host.toLowerCase() === "localhost") throw new Error("Host not allowed");

  // Normalize IPv6 literal: Node's url.hostname returns "[::1]" with brackets
  // but net.isIP() expects "::1" without brackets
  const hostRaw = host;
  const hostNormalized = (hostRaw.startsWith("[") && hostRaw.endsWith("]"))
    ? hostRaw.slice(1, -1)
    : hostRaw;

  if (!hostMatchesAllowlist(hostNormalized, opts.allowlist ?? [])) {
    throw new Error("Host not in allowlist");
  }

  // IP-literal host (use normalized host for detection)
  if (net.isIP(hostNormalized)) {
    if (isPrivateIp(hostNormalized)) throw new Error("Private IPs are not allowed");
    return {
      url,
      resolvedAddress: hostNormalized,
      resolvedFamily: net.isIP(hostNormalized)
    };
  }

  // Resolve A/AAAA (use normalized host for DNS)
  let addrs = [];
  try {
    const lookup = opts.lookup ?? dns.lookup;
    const a = await lookup(hostNormalized, { all: true });
    addrs = a.map((x) => x.address);
  } catch {
    throw new Error("DNS lookup failed");
  }

  if (!addrs.length) throw new Error("DNS lookup returned no addresses");
  for (const ip of addrs) {
    if (isPrivateIp(ip)) {
      throw new Error("Private IPs are not allowed");
    }
  }

  const resolvedAddress = addrs[0] || null;
  return {
    url,
    resolvedAddress,
    resolvedFamily: resolvedAddress ? net.isIP(resolvedAddress) : null
  };
}
