import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function leftPad(value, length) {
  return String(value).padStart(length, "0");
}

export function generateBase32Secret(bytes = 20) {
  const raw = crypto.randomBytes(bytes);
  let bits = "";
  for (const byte of raw) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return out;
}

export function decodeBase32(secret) {
  const normalized = String(secret || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of normalized) {
    const index = BASE32_ALPHABET.indexOf(ch);
    if (index < 0) throw new Error("Invalid base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter, digits = 6) {
  const key = decodeBase32(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return leftPad(binary % (10 ** digits), digits);
}

export function totp(secret, { stepSeconds = 30, digits = 6, nowMs = Date.now() } = {}) {
  const counter = Math.floor(nowMs / 1000 / stepSeconds);
  return hotp(secret, counter, digits);
}

export function verifyTotp(secret, code, { stepSeconds = 30, digits = 6, window = 1, nowMs = Date.now() } = {}) {
  const normalizedCode = String(code || "").trim();
  if (!/^\d{6}$/.test(normalizedCode)) return false;
  const currentCounter = Math.floor(nowMs / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(secret, currentCounter + offset, digits) === normalizedCode) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri({ issuer, label, secret }) {
  const safeIssuer = encodeURIComponent(String(issuer || "PuntosFieles"));
  const safeLabel = encodeURIComponent(String(label || "account"));
  const safeSecret = encodeURIComponent(String(secret || ""));
  return `otpauth://totp/${safeIssuer}:${safeLabel}?secret=${safeSecret}&issuer=${safeIssuer}&algorithm=SHA1&digits=6&period=30`;
}
