import { SignJWT, jwtVerify } from "jose";
import { config } from "../../config/index.js";
import { badRequest, forbidden } from "../../utils/http-error.js";
import { verifyQrToken } from "../../utils/qr-token.js";

const MAX_SECONDS = 24 * 60 * 60;
const signingKey = () => new TextEncoder().encode(config.JWT_SECRET);

export async function issueOfflineGrant(staff, { now = new Date() } = {}) {
  const issued = Math.floor(now.getTime() / 1000);
  const expires = issued + MAX_SECONDS;
  const grant = await new SignJWT({ sid: staff.id, bid: staff.business_id, purpose: "staff-offline-earn" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("puntosfieles").setAudience("staff-offline")
    .setIssuedAt(issued).setExpirationTime(expires).sign(signingKey());
  return { ok: true, grant, expiresAt: new Date(expires * 1000).toISOString() };
}

export async function verifyOfflineCaptureGrant({ grant, staff, capturedAt, now = new Date() }) {
  let payload;
  try {
    ({ payload } = await jwtVerify(grant, signingKey(), { algorithms: ["HS256"], issuer: "puntosfieles", audience: "staff-offline", currentDate: now }));
  } catch {
    throw forbidden("La autorización sin conexión falta o venció. Inicia sesión y solicita revisión de esta operación.");
  }
  if (payload.purpose !== "staff-offline-earn" || payload.sid !== staff.id || payload.bid !== staff.business_id) throw forbidden("La operación sin conexión pertenece a otro usuario o negocio.");
  const captured = typeof capturedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(capturedAt) ? Date.parse(capturedAt) : NaN;
  const issued = Number(payload.iat) * 1000, expires = Number(payload.exp) * 1000;
  if (!Number.isFinite(captured) || !Number.isFinite(issued) || !Number.isFinite(expires) || expires - issued > MAX_SECONDS * 1000 || captured < issued || captured >= expires || captured > now.getTime() + 30000 || now.getTime() - captured > MAX_SECONDS * 1000) throw badRequest("La fecha de captura no está dentro del período autorizado sin conexión.");
  return { captured, issued, expires };
}

export async function verifyCapturedQr({ token, grant, staff, capturedAt, now = new Date() }) {
  const { captured } = await verifyOfflineCaptureGrant({ grant, staff, capturedAt, now });
  let decoded;
  try { decoded = await verifyQrToken(token, { currentDate: new Date(captured) }); }
  catch { throw badRequest("El código del cliente no era válido al capturarlo. Solicita revisión de esta operación."); }
  if (!decoded.iat || captured < decoded.iat * 1000 || decoded.bid !== staff.business_id) throw forbidden("El código no corresponde al negocio o a la fecha de captura.");
  return decoded;
}
