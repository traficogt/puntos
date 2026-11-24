import { importPKCS8, importSPKI, SignJWT, jwtVerify, compactVerify } from "jose";
import { nanoid } from "nanoid";
import { config } from "../config/index.js";

/**
 * Signs a short-lived customer QR token (EdDSA JWT).
 * @param {string} businessId
 * @param {string} customerId
 * @param {number} [ttlSeconds]
 */
export async function signQrToken(businessId, customerId, ttlSeconds = 60) {
  if (!config.QR_PRIVATE_KEY_PEM) throw new Error("QR_PRIVATE_KEY_PEM not configured");
  const pk = await importPKCS8(config.QR_PRIVATE_KEY_PEM, "EdDSA");

  const jti = nanoid(16);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const token = await new SignJWT({ bid: businessId, cid: customerId })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(pk);

  return { token, jti, exp };
}

/**
 * Verifies signature and expiry, then returns the claims.
 * @param {string} token
 * @param {{ currentDate?: Date }} [options]
 */
export async function verifyQrToken(token, { currentDate = new Date() } = {}) {
  if (!config.QR_PUBLIC_KEY_PEM) throw new Error("QR_PUBLIC_KEY_PEM not configured");
  const pub = await importSPKI(config.QR_PUBLIC_KEY_PEM, "EdDSA");

  const { payload } = await jwtVerify(token, pub, { algorithms: ["EdDSA"], currentDate });

  return qrClaims(payload);
}

// Only for acknowledging a matching transaction already stored in the ledger.
// This verifies identity/signature, but cannot authorize a new award.
/** @param {string} token */
export async function verifyQrSignature(token) {
  if (!config.QR_PUBLIC_KEY_PEM) throw new Error("QR_PUBLIC_KEY_PEM not configured");
  const pub = await importSPKI(config.QR_PUBLIC_KEY_PEM, "EdDSA");
  const { payload } = await compactVerify(token, pub, { algorithms: ["EdDSA"] });
  return qrClaims(JSON.parse(new TextDecoder().decode(payload)));
}

/** @param {import("jose").JWTPayload} payload */
function qrClaims(payload) {
  const bid = String(payload.bid ?? "");
  const cid = String(payload.cid ?? "");
  const jti = String(payload.jti ?? "");
  const exp = Number(payload.exp ?? 0);

  if (!bid || !cid || !jti || !exp) throw new Error("Invalid QR token");
  return { bid, cid, jti, exp, iat: Number(payload.iat ?? 0) };
}
