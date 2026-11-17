import dns from "node:dns/promises";
import net from "node:net";

// Webhook destinations must be globally routable unicast addresses. Ranges are
// from the IANA IPv4/IPv6 special-purpose registries (RFC 6890 and updates).
const NON_PUBLIC_V4 = new net.BlockList();
for (const [network, prefix] of /** @type {Array<[string, number]>} */ ([
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata services
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4] // reserved, including 255.255.255.255 broadcast
])) NON_PUBLIC_V4.addSubnet(network, prefix, "ipv4");

const GLOBAL_UNICAST_V6 = new net.BlockList();
GLOBAL_UNICAST_V6.addSubnet("2000::", 3, "ipv6");
// Special-purpose blocks inside 2000::/3 that are not ordinary public hosts.
const NON_PUBLIC_GLOBAL_V6 = new net.BlockList();
NON_PUBLIC_GLOBAL_V6.addSubnet("2001::", 23, "ipv6"); // IETF protocol assignments, incl. Teredo and benchmarking
NON_PUBLIC_GLOBAL_V6.addSubnet("2001:db8::", 32, "ipv6"); // documentation
NON_PUBLIC_GLOBAL_V6.addSubnet("3fff::", 20, "ipv6"); // documentation
// Prefixes that carry an IPv4 destination; the embedded address decides.
const NAT64_V6 = new net.BlockList();
NAT64_V6.addSubnet("64:ff9b::", 96, "ipv6"); // RFC 6052 well-known NAT64 prefix
const SIX_TO_FOUR_V6 = new net.BlockList();
SIX_TO_FOUR_V6.addSubnet("2002::", 16, "ipv6"); // RFC 3056 6to4

/** @param {string} ip a valid IPv6 address without a zone @returns {number[]|null} 16 bytes */
function ipv6Bytes(ip) {
  let text = ip.toLowerCase();
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    if (net.isIP(dotted[2]) !== 4) return null;
    const [a, b, c, d] = dotted[2].split(".").map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part) => (part ? part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(fill).fill(0), ...rest];
  if (groups.some((group) => Number.isNaN(group))) return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

/** @param {number[]} bytes @param {number} offset */
function embeddedV4(bytes, offset) {
  return bytes.slice(offset, offset + 4).join(".");
}

/**
 * Returns the address to dial when `ip` is a public unicast destination, or
 * null for loopback, private, link-local, multicast, reserved, documentation
 * and other special-purpose addresses. IPv4-mapped, NAT64 and 6to4 addresses
 * are judged by the IPv4 address they carry.
 * @param {string} ip
 * @returns {{ address: string, family: 4|6 } | null}
 */
export function publicUnicastTarget(ip) {
  const family = net.isIP(String(ip ?? ""));
  if (family === 4) return NON_PUBLIC_V4.check(ip, "ipv4") ? null : { address: ip, family: 4 };
  // Zone identifiers (fe80::1%eth0) only name local-scope addresses.
  if (family !== 6 || ip.includes("%")) return null;
  const bytes = ipv6Bytes(ip);
  if (!bytes) return null;
  // ::ffff:a.b.c.d reaches the IPv4 host itself; dial it as IPv4.
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return publicUnicastTarget(embeddedV4(bytes, 12));
  }
  if (NAT64_V6.check(ip, "ipv6")) return publicUnicastTarget(embeddedV4(bytes, 12)) ? { address: ip, family: 6 } : null;
  if (SIX_TO_FOUR_V6.check(ip, "ipv6")) return publicUnicastTarget(embeddedV4(bytes, 2)) ? { address: ip, family: 6 } : null;
  // Everything outside 2000::/3 is denied: ::, ::1, IPv4-compatible ::a.b.c.d,
  // fc00::/7, fe80::/10, fec0::/10, ff00::/8, 100::/64, 64:ff9b:1::/48, ...
  if (!GLOBAL_UNICAST_V6.check(ip, "ipv6") || NON_PUBLIC_GLOBAL_V6.check(ip, "ipv6")) return null;
  return { address: ip, family: 6 };
}

/** @param {string} ip */
export function isPublicUnicastAddress(ip) {
  return publicUnicastTarget(ip) !== null;
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
 * Validates a webhook URL and blocks SSRF to every non-public address.
 * Resolves DNS and checks all returned addresses.
 * @param {string} urlStr
 * @param {{ requireHttps?: boolean, allowlist?: string[], lookup?: any }} opts
 * @returns {Promise<URL>}
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
    const target = publicUnicastTarget(hostNormalized);
    if (!target) throw new Error("Private IPs are not allowed");
    return { url, resolvedAddress: target.address, resolvedFamily: target.family };
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
  // Every answer must be public: a mixed answer set is how DNS rebinding hides.
  const targets = addrs.map((ip) => publicUnicastTarget(ip));
  if (targets.some((target) => !target)) throw new Error("Private IPs are not allowed");

  return { url, resolvedAddress: targets[0].address, resolvedFamily: targets[0].family };
}
