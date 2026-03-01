import { importPKCS8, importSPKI, SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { config } from "../config/index.js";

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

export async function verifyQrToken(token) {
  if (!config.QR_PUBLIC_KEY_PEM) throw new Error("QR_PUBLIC_KEY_PEM not configured");
  const pub = await importSPKI(config.QR_PUBLIC_KEY_PEM, "EdDSA");

  const { payload } = await jwtVerify(token, pub, { algorithms: ["EdDSA"] });

  const bid = String(payload.bid ?? "");
  const cid = String(payload.cid ?? "");
  const jti = String(payload.jti ?? "");
  const exp = Number(payload.exp ?? 0);

  if (!bid || !cid || !jti || !exp) throw new Error("Invalid QR token");
  return { bid, cid, jti, exp };
}
