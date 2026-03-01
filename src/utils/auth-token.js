import { SignJWT, jwtVerify } from "jose";
import { config } from "../config/index.js";

const enc = new TextEncoder();
const secret = enc.encode(config.JWT_SECRET);

export async function signStaffToken(payload, expiresInSeconds = 30 * 24 * 60 * 60) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, typ: "staff" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(secret);
}

export async function signCustomerToken(payload, expiresInSeconds = 180 * 24 * 60 * 60) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, typ: "customer" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(secret);
}

export async function signSuperToken(payload, expiresInSeconds = 7 * 24 * 60 * 60) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, typ: "super" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(secret);
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  return payload;
}

export function cookieOpts() {
  const prod = config.NODE_ENV === "production";
  const securePreferred = prod || String(config.APP_ORIGIN || "").startsWith("https://");
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: securePreferred, // set true when behind HTTPS or in prod
    path: "/"
  };
}

export function cookieOptsWith(overrides = {}) {
  return {
    ...cookieOpts(),
    ...overrides
  };
}
