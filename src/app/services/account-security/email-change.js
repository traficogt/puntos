import { dbQuery, withTransaction } from "../../database.js";
import { StaffRepo } from "../../repositories/staff-repository.js";
import { AuthActionTokenRepo } from "../../repositories/auth-action-token-repository.js";
import { SuperAdminAuthRepo } from "../../repositories/super-admin-auth-repository.js";
import { invalidateBrowserSessionsForActor } from "../auth-session-service.js";
import { badRequest, conflict, notFound, unauthorized } from "../../../utils/http-error.js";
import { logger } from "../../../utils/logger.js";
import { sendSecurityNotification } from "../security-notification-service.js";
import {
  id,
  hashActionToken,
  randomActionToken,
  normalizeEmail,
  logAudit,
  logSecurity,
  getStaffMfaRecord,
} from "./shared.js";

/** @typedef {{ query: typeof dbQuery }} TxClient */
/** @typedef {import("./shared.js").AccountSecurityActionToken} AccountSecurityActionToken */

/**
 * @param {string} token
 * @param {string} newEmail
 * @param {string} role
 */
function emailChangeLines(token, newEmail, role) {
  return [
    `Se solicitó cambiar el correo ${role} a: ${newEmail}`,
    `Token: ${token}`,
    "Debes confirmar desde ambos correos para completar el cambio.",
  ];
}

/** @param {{ staff: { id: string }, newEmail: string, ip?: string | null, ua?: string | null }} input */
export async function requestStaffEmailChange({ staff, newEmail, ip = null, ua = null }) {
  const freshStaff = await getStaffMfaRecord(staff.id);
  const normalizedNewEmail = normalizeEmail(newEmail);
  if (!normalizedNewEmail) throw badRequest("Falta el correo");
  if (normalizeEmail(freshStaff.email) === normalizedNewEmail)
    throw conflict("El nuevo correo es igual al actual");
  const existing = await StaffRepo.getByEmail(normalizedNewEmail);
  if (existing && String(existing.id) !== String(freshStaff.id))
    throw conflict("Este correo ya está en uso");

  const requestId = id();
  const oldToken = randomActionToken();
  const newToken = randomActionToken();
  const payload = {
    request_id: requestId,
    new_email: normalizedNewEmail,
    old_email: normalizeEmail(freshStaff.email),
  };

  await withTransaction(async (/** @type {TxClient} */ client) => {
    await AuthActionTokenRepo.create(
      {
        id: id(),
        request_id: requestId,
        actor_type: "STAFF",
        actor_id: freshStaff.id,
        actor_email: normalizeEmail(freshStaff.email),
        business_id: freshStaff.business_id,
        purpose: "STAFF_EMAIL_CHANGE_OLD",
        token_hash: hashActionToken(oldToken),
        payload,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      client.query.bind(client),
    );
    await AuthActionTokenRepo.create(
      {
        id: id(),
        request_id: requestId,
        actor_type: "STAFF",
        actor_id: freshStaff.id,
        actor_email: normalizedNewEmail,
        business_id: freshStaff.business_id,
        purpose: "STAFF_EMAIL_CHANGE_NEW",
        token_hash: hashActionToken(newToken),
        payload,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      client.query.bind(client),
    );
  });

  await logAudit({
    businessId: freshStaff.business_id,
    actorType: "STAFF",
    actorId: freshStaff.id,
    action: "staff.email_change.requested",
    ip,
    ua,
    meta: { new_email: normalizedNewEmail },
  });
  await sendSecurityNotification({
    businessId: freshStaff.business_id,
    to: freshStaff.email,
    subject: "PuntosFieles • Confirmación de cambio de correo",
    lines: emailChangeLines(oldToken, normalizedNewEmail, "actual"),
  });
  await sendSecurityNotification({
    businessId: freshStaff.business_id,
    to: normalizedNewEmail,
    subject: "PuntosFieles • Confirmación de correo nuevo",
    lines: emailChangeLines(newToken, normalizedNewEmail, "nuevo"),
  });
  return { ok: true, requestId };
}

/**
 * @param {string} requestId
 * @param {typeof dbQuery} [query]
 */
async function maybeApplyStaffEmailChange(requestId, query = dbQuery) {
  /** @type {AccountSecurityActionToken[]} */
  const tokens = await AuthActionTokenRepo.listByRequestId(requestId, query);
  const oldToken = tokens.find((row) => row.purpose === "STAFF_EMAIL_CHANGE_OLD");
  const newToken = tokens.find((row) => row.purpose === "STAFF_EMAIL_CHANGE_NEW");
  if (!oldToken || !newToken || !oldToken.used_at || !newToken.used_at) return { applied: false };
  const staff = await StaffRepo.getById(oldToken.actor_id);
  if (!staff) throw notFound("Staff no encontrado");
  const newEmail = normalizeEmail(oldToken.payload?.new_email);
  const existing = await StaffRepo.getByEmail(newEmail);
  if (existing && String(existing.id) !== String(staff.id))
    throw conflict("Este correo ya está en uso");
  await query(`UPDATE staff_users SET email = $2 WHERE id = $1`, [staff.id, newEmail]);
  await invalidateBrowserSessionsForActor({
    actorType: "STAFF",
    actorId: staff.id,
    reason: "email_change",
  }).catch((err) =>
    logger.warn(
      { err, reason: "email_change" },
      "Browser session invalidation failed after security change",
    ),
  );
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: newEmail,
    subject: "PuntosFieles • Correo actualizado",
    lines: ["Tu correo de acceso fue actualizado.", "Se invalidaron tus sesiones activas."],
  });
  return { applied: true, email: newEmail, staff };
}

/** @param {{ token: string, ip?: string | null, ua?: string | null }} input */
export async function confirmStaffEmailChange({ token, ip = null, ua: _ua = null }) {
  const active = await AuthActionTokenRepo.lookupActiveByTokenHash(hashActionToken(token));
  if (
    !active ||
    active.actor_type !== "STAFF" ||
    !String(active.purpose || "").startsWith("STAFF_EMAIL_CHANGE_")
  ) {
    throw badRequest(
      "El enlace para cambiar el correo no es válido o ya venció",
      "VALIDATION_ERROR",
    );
  }
  const used = await AuthActionTokenRepo.markUsed(active.id, { confirmed: true });
  const result = await maybeApplyStaffEmailChange(used.request_id);
  await logAudit({
    businessId: active.business_id,
    actorType: "STAFF",
    actorId: active.actor_id,
    action: "staff.email_change.confirmed",
    ip,
    ua: _ua,
    meta: { purpose: active.purpose, request_id: active.request_id, applied: result.applied },
  });
  return { ok: true, applied: result.applied };
}

/** @param {{ currentEmail: string, newEmail: string, ip?: string | null, ua?: string | null }} input */
export async function requestSuperEmailChange({
  currentEmail,
  newEmail,
  ip = null,
  ua: _ua = null,
}) {
  const auth = await SuperAdminAuthRepo.getEffective();
  if (normalizeEmail(currentEmail) !== normalizeEmail(auth.email))
    throw unauthorized("Credenciales de superadministrador inválidas", "VALIDATION_ERROR");
  const normalizedNewEmail = normalizeEmail(newEmail);
  if (!normalizedNewEmail) throw badRequest("Falta el correo");
  if (normalizedNewEmail === normalizeEmail(auth.email))
    throw conflict("El nuevo correo es igual al actual");

  const requestId = id();
  const oldToken = randomActionToken();
  const newToken = randomActionToken();
  const payload = {
    request_id: requestId,
    new_email: normalizedNewEmail,
    old_email: normalizeEmail(auth.email),
  };

  await withTransaction(async (/** @type {TxClient} */ client) => {
    await AuthActionTokenRepo.create(
      {
        id: id(),
        request_id: requestId,
        actor_type: "SUPER",
        actor_email: normalizeEmail(auth.email),
        purpose: "SUPER_EMAIL_CHANGE_OLD",
        token_hash: hashActionToken(oldToken),
        payload,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      client.query.bind(client),
    );
    await AuthActionTokenRepo.create(
      {
        id: id(),
        request_id: requestId,
        actor_type: "SUPER",
        actor_email: normalizedNewEmail,
        purpose: "SUPER_EMAIL_CHANGE_NEW",
        token_hash: hashActionToken(newToken),
        payload,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      client.query.bind(client),
    );
  });

  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • Confirmación de cambio de correo super admin",
    lines: emailChangeLines(oldToken, normalizedNewEmail, "actual"),
  });
  await sendSecurityNotification({
    to: normalizedNewEmail,
    subject: "PuntosFieles • Confirmación de correo nuevo super admin",
    lines: emailChangeLines(newToken, normalizedNewEmail, "nuevo"),
  });
  await logSecurity({
    event_type: "super_email_change_requested",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    meta: { new_email: normalizedNewEmail },
  });
  return { ok: true, requestId };
}

/**
 * @param {string} requestId
 * @param {typeof dbQuery} [query]
 */
async function maybeApplySuperEmailChange(requestId, query = dbQuery) {
  /** @type {AccountSecurityActionToken[]} */
  const tokens = await AuthActionTokenRepo.listByRequestId(requestId, query);
  const oldToken = tokens.find((row) => row.purpose === "SUPER_EMAIL_CHANGE_OLD");
  const newToken = tokens.find((row) => row.purpose === "SUPER_EMAIL_CHANGE_NEW");
  if (!oldToken || !newToken || !oldToken.used_at || !newToken.used_at) return { applied: false };
  const newEmail = normalizeEmail(oldToken.payload?.new_email);
  await SuperAdminAuthRepo.update({ email: newEmail }, query);
  await invalidateBrowserSessionsForActor({
    actorType: "SUPER",
    actorEmail: normalizeEmail(oldToken.payload?.old_email),
    reason: "email_change",
  }).catch((err) =>
    logger.warn(
      { err, reason: "email_change" },
      "Browser session invalidation failed after security change",
    ),
  );
  await sendSecurityNotification({
    to: newEmail,
    subject: "PuntosFieles • Correo super admin actualizado",
    lines: ["El correo del super admin fue actualizado.", "Se invalidaron las sesiones activas."],
  });
  return { applied: true, email: newEmail };
}

/** @param {{ token: string, ip?: string | null, ua?: string | null }} input */
export async function confirmSuperEmailChange({ token, ip = null, ua: _ua = null }) {
  const active = await AuthActionTokenRepo.lookupActiveByTokenHash(hashActionToken(token));
  if (
    !active ||
    active.actor_type !== "SUPER" ||
    !String(active.purpose || "").startsWith("SUPER_EMAIL_CHANGE_")
  ) {
    throw badRequest(
      "El enlace para cambiar el correo no es válido o ya venció",
      "VALIDATION_ERROR",
    );
  }
  const used = await AuthActionTokenRepo.markUsed(active.id, { confirmed: true });
  const result = await maybeApplySuperEmailChange(used.request_id);
  await logSecurity({
    event_type: "super_email_change_confirmed",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    meta: { purpose: active.purpose, request_id: active.request_id, applied: result.applied },
  });
  return { ok: true, applied: result.applied };
}
