// crypto.randomUUID() exists only in secure contexts. When the browser loads PF
// over plain http from a non-loopback host (a LAN preview, or the compose
// network in docker-mode e2e) it is undefined, and every screen that mints an
// idempotency key during render (Recovery, campaigns, pilots, demo stores)
// throws straight into the error boundary. crypto.getRandomValues() works in
// every context, so derive an RFC 4122 version-4 UUID from it when needed.
const webCrypto = globalThis.crypto;
if (
  webCrypto &&
  typeof webCrypto.randomUUID !== "function" &&
  typeof webCrypto.getRandomValues === "function"
) {
  const randomUUID = () => {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  Object.defineProperty(webCrypto, "randomUUID", {
    value: randomUUID,
    configurable: true,
    writable: true,
  });
}
