import { withTransaction } from "../../database.js";
import { StaffRepo } from "../../repositories/staff-repository.js";
import { AuthActionTokenRepo } from "../../repositories/auth-action-token-repository.js";
import { SuperAdminAuthRepo } from "../../repositories/super-admin-auth-repository.js";
import { invalidateBrowserSessionsForActor } from "../auth-session-service.js";
import { assertPasswordAllowed } from "../../../utils/password-policy.js";
import { hashPassword } from "../../../utils/password-hash.js";
import { badRequest, notFound } from "../../../utils/http-error.js";
import { logger } from "../../../utils/logger.js";
import { sendSecurityNotification } from "../security-notification-service.js";
import { id, hashActionToken, randomActionToken, normalizeEmail, logSecurity } from "./shared.js";

/** @typedef {import("../../../types/db.js").DbQueryClient} TxClient */
/** @typedef {import("./shared.js").AccountSecurityStaffRecord} AccountSecurityStaffRecord */
/** @typedef {import("./shared.js").AccountSecuritySuperAuthRecord} AccountSecuritySuperAuthRecord */

/** @param {string} token */
function resetNotificationLines(token) {
  return [
    "Se solicitó un restablecimiento de contraseña para tu cuenta.",
    `Token: ${token}`,
    "Si no fuiste tú, ignora este mensaje y revisa la seguridad de tu cuenta.",
  ];
}

/**
 * @param {AccountSecurityStaffRecord} staff
 * @param {string} candidatePassword
 */
function passwordContextForStaff(staff, candidatePassword) {
  assertPasswordAllowed(candidatePassword, {
    email: staff.email,
    name: staff.name,
    phone: staff.phone,
  });
}

/**
 * @param {AccountSecuritySuperAuthRecord} authRecord
 * @param {string} candidatePassword
 */
function passwordContextForSuper(authRecord, candidatePassword) {
  assertPasswordAllowed(candidatePassword, {
    email: authRecord.email,
    name: "super admin",
    businessName: "puntos",
  });
}

/** @param {string} email */
async function findStaffForReset(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const staff = await StaffRepo.getByEmail(normalized);
  if (!staff || !staff.active || !staff.email) return null;
  return staff;
}

/** @param {{ email: string, ip?: string | null, ua?: string | null }} input */
export async function requestStaffPasswordReset({ email, ip = null, ua: _ua = null }) {
  const staff = await findStaffForReset(email);
  if (!staff) return { ok: true };

  const token = randomActionToken();
  await AuthActionTokenRepo.create({
    id: id(),
    actor_type: "STAFF",
    actor_id: staff.id,
    actor_email: normalizeEmail(staff.email),
    business_id: staff.business_id,
    purpose: "STAFF_PASSWORD_RESET",
    token_hash: hashActionToken(token),
    payload: {},
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });

  await logSecurity({
    event_type: "staff_password_reset_requested",
    severity: "MEDIUM",
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    ip,
    route: "/api/public/staff/password-reset/request",
    method: "POST",
    meta: { email: normalizeEmail(staff.email) },
  });

  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • Restablecimiento de contraseña",
    lines: resetNotificationLines(token),
  });

  return { ok: true };
}

/** @param {{ token: string, newPassword: string, ip?: string | null, ua?: string | null }} input */
export async function completeStaffPasswordReset({
  token,
  newPassword,
  ip = null,
  ua: _ua = null,
}) {
  const active = await AuthActionTokenRepo.lookupActiveByTokenHash(hashActionToken(token));
  if (!active || active.purpose !== "STAFF_PASSWORD_RESET" || active.actor_type !== "STAFF") {
    throw badRequest(
      "El enlace para restablecer la contraseña no es válido o ya venció",
      "VALIDATION_ERROR",
    );
  }
  const staff = await StaffRepo.getById(active.actor_id);
  if (!staff || !staff.active) throw notFound("Staff no encontrado");
  passwordContextForStaff(staff, newPassword);
  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (/** @type {TxClient} */ client) => {
    await client.query(`UPDATE staff_users SET password_hash = $2 WHERE id = $1`, [
      staff.id,
      passwordHash,
    ]);
    await AuthActionTokenRepo.markUsed(active.id, { completed: true }, client.query.bind(client));
  });

  await invalidateBrowserSessionsForActor({
    actorType: "STAFF",
    actorId: staff.id,
    reason: "password_reset",
  }).catch((err) =>
    logger.warn(
      { err, reason: "password_reset" },
      "Browser session invalidation failed after security change",
    ),
  );
  await logSecurity({
    event_type: "staff_password_reset_completed",
    severity: "HIGH",
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    ip,
    route: "/api/public/staff/password-reset/confirm",
    method: "POST",
    meta: { email: normalizeEmail(staff.email) },
  });
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • Contraseña cambiada",
    lines: ["La contraseña de tu cuenta fue cambiada.", "Se invalidaron tus sesiones activas."],
  });
  return { ok: true };
}

/** @param {{ email: string, ip?: string | null, ua?: string | null }} input */
export async function requestSuperPasswordReset({ email, ip = null, ua: _ua = null }) {
  const auth = await SuperAdminAuthRepo.getEffective();
  if (!auth.email || normalizeEmail(email) !== normalizeEmail(auth.email)) return { ok: true };
  const token = randomActionToken();
  await AuthActionTokenRepo.create({
    id: id(),
    actor_type: "SUPER",
    actor_email: normalizeEmail(auth.email),
    purpose: "SUPER_PASSWORD_RESET",
    token_hash: hashActionToken(token),
    payload: {},
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  await logSecurity({
    event_type: "super_password_reset_requested",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    route: "/api/public/super/password-reset/request",
    method: "POST",
    meta: { email: normalizeEmail(auth.email) },
  });
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • Restablecimiento de contraseña super admin",
    lines: resetNotificationLines(token),
  });
  return { ok: true };
}

/** @param {{ token: string, newPassword: string, ip?: string | null, ua?: string | null }} input */
export async function completeSuperPasswordReset({
  token,
  newPassword,
  ip = null,
  ua: _ua = null,
}) {
  const active = await AuthActionTokenRepo.lookupActiveByTokenHash(hashActionToken(token));
  if (!active || active.purpose !== "SUPER_PASSWORD_RESET" || active.actor_type !== "SUPER") {
    throw badRequest(
      "El enlace para restablecer la contraseña no es válido o ya venció",
      "VALIDATION_ERROR",
    );
  }
  const auth = await SuperAdminAuthRepo.getEffective();
  passwordContextForSuper(auth, newPassword);
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (/** @type {TxClient} */ client) => {
    await SuperAdminAuthRepo.update({ password_hash: passwordHash }, client.query.bind(client));
    await AuthActionTokenRepo.markUsed(active.id, { completed: true }, client.query.bind(client));
  });
  await invalidateBrowserSessionsForActor({
    actorType: "SUPER",
    actorEmail: normalizeEmail(auth.email),
    reason: "password_reset",
  }).catch((err) =>
    logger.warn(
      { err, reason: "password_reset" },
      "Browser session invalidation failed after security change",
    ),
  );
  await logSecurity({
    event_type: "super_password_reset_completed",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    route: "/api/public/super/password-reset/confirm",
    method: "POST",
    meta: { email: normalizeEmail(auth.email) },
  });
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • Contraseña super admin cambiada",
    lines: ["La contraseña del super admin fue cambiada.", "Se invalidaron las sesiones activas."],
  });
  return { ok: true };
}
