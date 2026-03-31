import crypto from "node:crypto";

import { dbQuery, withTransaction } from "../database.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { AuthActionTokenRepo } from "../repositories/auth-action-token-repository.js";
import { SuperAdminAuthRepo } from "../repositories/super-admin-auth-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { invalidateBrowserSessionsForActor, markBrowserSessionReauthenticated } from "./auth-session-service.js";
import { assertPasswordAllowed } from "../../utils/password-policy.js";
import { hashPassword, verifyPassword } from "../../utils/password-hash.js";
import { badRequest, conflict, notFound, unauthorized } from "../../utils/http-error.js";
import { encryptSecret, decryptSecretMaybe } from "../../utils/secret-crypto.js";
import { buildOtpAuthUri, generateBase32Secret, verifyTotp } from "../../utils/totp.js";
import { sendSecurityNotification } from "./security-notification-service.js";

function id() {
  return crypto.randomUUID();
}

function hashActionToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function randomActionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function requireTotpFormat(code) {
  const normalized = String(code || "").trim();
  if (!/^\d{6}$/.test(normalized)) throw badRequest("Invalid MFA code");
  return normalized;
}

async function logAudit({ businessId = null, actorType, actorId = null, action, meta = {}, ip = null, ua = null }) {
  await AuditRepo.log({
    id: id(),
    business_id: businessId,
    actor_type: actorType,
    actor_id: actorId,
    action,
    ip,
    ua,
    meta
  }).catch(() => {});
}

async function logSecurity(event) {
  await SecurityEventRepo.logPrivileged(event).catch(() => {});
}

function resetNotificationLines(token) {
  return [
    "Se solicitó un restablecimiento de contraseña para tu cuenta.",
    `Token: ${token}`,
    "Si no fuiste tú, ignora este mensaje y revisa la seguridad de tu cuenta."
  ];
}

function emailChangeLines(token, newEmail, role) {
  return [
    `Se solicitó cambiar el correo ${role} a: ${newEmail}`,
    `Token: ${token}`,
    "Debes confirmar desde ambos correos para completar el cambio."
  ];
}

function passwordContextForStaff(staff, candidatePassword) {
  assertPasswordAllowed(candidatePassword, {
    email: staff.email,
    name: staff.name,
    phone: staff.phone
  });
}

function passwordContextForSuper(authRecord, candidatePassword) {
  assertPasswordAllowed(candidatePassword, {
    email: authRecord.email,
    name: "super admin",
    businessName: "puntos"
  });
}

async function findStaffForReset(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const staff = await StaffRepo.getByEmail(normalized);
  if (!staff || !staff.active || !staff.email) return null;
  return staff;
}

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
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
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
    meta: { email: normalizeEmail(staff.email) }
  });

  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • Restablecimiento de contraseña",
    lines: resetNotificationLines(token)
  });

  return { ok: true };
}

export async function completeStaffPasswordReset({ token, newPassword, ip = null, ua: _ua = null }) {
  const active = await AuthActionTokenRepo.lookupActiveByTokenHash(hashActionToken(token));
  if (!active || active.purpose !== "STAFF_PASSWORD_RESET" || active.actor_type !== "STAFF") {
    throw badRequest("Invalid or expired reset token");
  }
  const staff = await StaffRepo.getById(active.actor_id);
  if (!staff || !staff.active) throw notFound("Staff not found");
  passwordContextForStaff(staff, newPassword);
  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    await client.query(`UPDATE staff_users SET password_hash = $2 WHERE id = $1`, [staff.id, passwordHash]);
    await AuthActionTokenRepo.markUsed(active.id, { completed: true }, client.query.bind(client));
  });

  await invalidateBrowserSessionsForActor({ actorType: "STAFF", actorId: staff.id, reason: "password_reset" }).catch(() => {});
  await logSecurity({
    event_type: "staff_password_reset_completed",
    severity: "HIGH",
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    ip,
    route: "/api/public/staff/password-reset/confirm",
    method: "POST",
    meta: { email: normalizeEmail(staff.email) }
  });
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • Contraseña cambiada",
    lines: ["La contraseña de tu cuenta fue cambiada.", "Se invalidaron tus sesiones activas."]
  });
  return { ok: true };
}

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
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  });
  await logSecurity({
    event_type: "super_password_reset_requested",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    route: "/api/public/super/password-reset/request",
    method: "POST",
    meta: { email: normalizeEmail(auth.email) }
  });
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • Restablecimiento de contraseña super admin",
    lines: resetNotificationLines(token)
  });
  return { ok: true };
}

export async function completeSuperPasswordReset({ token, newPassword, ip = null, ua: _ua = null }) {
  const active = await AuthActionTokenRepo.lookupActiveByTokenHash(hashActionToken(token));
  if (!active || active.purpose !== "SUPER_PASSWORD_RESET" || active.actor_type !== "SUPER") {
    throw badRequest("Invalid or expired reset token");
  }
  const auth = await SuperAdminAuthRepo.getEffective();
  passwordContextForSuper(auth, newPassword);
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await SuperAdminAuthRepo.update({ password_hash: passwordHash }, client.query.bind(client));
    await AuthActionTokenRepo.markUsed(active.id, { completed: true }, client.query.bind(client));
  });
  await invalidateBrowserSessionsForActor({ actorType: "SUPER", actorEmail: normalizeEmail(auth.email), reason: "password_reset" }).catch(() => {});
  await logSecurity({
    event_type: "super_password_reset_completed",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    route: "/api/public/super/password-reset/confirm",
    method: "POST",
    meta: { email: normalizeEmail(auth.email) }
  });
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • Contraseña super admin cambiada",
    lines: ["La contraseña del super admin fue cambiada.", "Se invalidaron las sesiones activas."]
  });
  return { ok: true };
}

export async function requestStaffEmailChange({ staff, newEmail, ip = null, ua = null }) {
  const freshStaff = await getStaffMfaRecord(staff.id);
  const normalizedNewEmail = normalizeEmail(newEmail);
  if (!normalizedNewEmail) throw badRequest("Email required");
  if (normalizeEmail(freshStaff.email) === normalizedNewEmail) throw conflict("New email matches current email");
  const existing = await StaffRepo.getByEmail(normalizedNewEmail);
  if (existing && String(existing.id) !== String(freshStaff.id)) throw conflict("Email already in use");

  const requestId = id();
  const oldToken = randomActionToken();
  const newToken = randomActionToken();
  const payload = { request_id: requestId, new_email: normalizedNewEmail, old_email: normalizeEmail(freshStaff.email) };

  await withTransaction(async (client) => {
    await AuthActionTokenRepo.create({
      id: id(),
      request_id: requestId,
      actor_type: "STAFF",
      actor_id: freshStaff.id,
      actor_email: normalizeEmail(freshStaff.email),
      business_id: freshStaff.business_id,
      purpose: "STAFF_EMAIL_CHANGE_OLD",
      token_hash: hashActionToken(oldToken),
      payload,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }, client.query.bind(client));
    await AuthActionTokenRepo.create({
      id: id(),
      request_id: requestId,
      actor_type: "STAFF",
      actor_id: freshStaff.id,
      actor_email: normalizedNewEmail,
      business_id: freshStaff.business_id,
      purpose: "STAFF_EMAIL_CHANGE_NEW",
      token_hash: hashActionToken(newToken),
      payload,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }, client.query.bind(client));
  });

  await logAudit({
    businessId: freshStaff.business_id,
    actorType: "STAFF",
    actorId: freshStaff.id,
    action: "staff.email_change.requested",
    ip,
    ua,
    meta: { new_email: normalizedNewEmail }
  });
  await sendSecurityNotification({
    businessId: freshStaff.business_id,
    to: freshStaff.email,
    subject: "PuntosFieles • Confirmación de cambio de correo",
    lines: emailChangeLines(oldToken, normalizedNewEmail, "actual")
  });
  await sendSecurityNotification({
    businessId: freshStaff.business_id,
    to: normalizedNewEmail,
    subject: "PuntosFieles • Confirmación de correo nuevo",
    lines: emailChangeLines(newToken, normalizedNewEmail, "nuevo")
  });
  return { ok: true, requestId };
}

async function maybeApplyStaffEmailChange(requestId, query = dbQuery) {
  const tokens = await AuthActionTokenRepo.listByRequestId(requestId, query);
  const oldToken = tokens.find((row) => row.purpose === "STAFF_EMAIL_CHANGE_OLD");
  const newToken = tokens.find((row) => row.purpose === "STAFF_EMAIL_CHANGE_NEW");
  if (!oldToken || !newToken || !oldToken.used_at || !newToken.used_at) return { applied: false };
  const staff = await StaffRepo.getById(oldToken.actor_id);
  if (!staff) throw notFound("Staff not found");
  const newEmail = normalizeEmail(oldToken.payload?.new_email);
  const existing = await StaffRepo.getByEmail(newEmail);
  if (existing && String(existing.id) !== String(staff.id)) throw conflict("Email already in use");
  await query(`UPDATE staff_users SET email = $2 WHERE id = $1`, [staff.id, newEmail]);
  await invalidateBrowserSessionsForActor({ actorType: "STAFF", actorId: staff.id, reason: "email_change" }).catch(() => {});
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: newEmail,
    subject: "PuntosFieles • Correo actualizado",
    lines: ["Tu correo de acceso fue actualizado.", "Se invalidaron tus sesiones activas."]
  });
  return { applied: true, email: newEmail, staff };
}

export async function confirmStaffEmailChange({ token, ip = null, ua: _ua = null }) {
  const active = await AuthActionTokenRepo.lookupActiveByTokenHash(hashActionToken(token));
  if (!active || active.actor_type !== "STAFF" || !String(active.purpose || "").startsWith("STAFF_EMAIL_CHANGE_")) {
    throw badRequest("Invalid or expired email-change token");
  }
  const used = await AuthActionTokenRepo.markUsed(active.id, { confirmed: true });
  const result = await maybeApplyStaffEmailChange(used.request_id);
  await logAudit({
    businessId: active.business_id,
    actorType: "STAFF",
    actorId: active.actor_id,
    action: "staff.email_change.confirmed",
    ip,
    ua,
    meta: { purpose: active.purpose, request_id: active.request_id, applied: result.applied }
  });
  return { ok: true, applied: result.applied };
}

export async function requestSuperEmailChange({ currentEmail, newEmail, ip = null, ua: _ua = null }) {
  const auth = await SuperAdminAuthRepo.getEffective();
  if (normalizeEmail(currentEmail) !== normalizeEmail(auth.email)) throw unauthorized("Invalid super admin credentials");
  const normalizedNewEmail = normalizeEmail(newEmail);
  if (!normalizedNewEmail) throw badRequest("Email required");
  if (normalizedNewEmail === normalizeEmail(auth.email)) throw conflict("New email matches current email");

  const requestId = id();
  const oldToken = randomActionToken();
  const newToken = randomActionToken();
  const payload = { request_id: requestId, new_email: normalizedNewEmail, old_email: normalizeEmail(auth.email) };

  await withTransaction(async (client) => {
    await AuthActionTokenRepo.create({
      id: id(),
      request_id: requestId,
      actor_type: "SUPER",
      actor_email: normalizeEmail(auth.email),
      purpose: "SUPER_EMAIL_CHANGE_OLD",
      token_hash: hashActionToken(oldToken),
      payload,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }, client.query.bind(client));
    await AuthActionTokenRepo.create({
      id: id(),
      request_id: requestId,
      actor_type: "SUPER",
      actor_email: normalizedNewEmail,
      purpose: "SUPER_EMAIL_CHANGE_NEW",
      token_hash: hashActionToken(newToken),
      payload,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }, client.query.bind(client));
  });

  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • Confirmación de cambio de correo super admin",
    lines: emailChangeLines(oldToken, normalizedNewEmail, "actual")
  });
  await sendSecurityNotification({
    to: normalizedNewEmail,
    subject: "PuntosFieles • Confirmación de correo nuevo super admin",
    lines: emailChangeLines(newToken, normalizedNewEmail, "nuevo")
  });
  await logSecurity({
    event_type: "super_email_change_requested",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    meta: { new_email: normalizedNewEmail }
  });
  return { ok: true, requestId };
}

async function maybeApplySuperEmailChange(requestId, query = dbQuery) {
  const tokens = await AuthActionTokenRepo.listByRequestId(requestId, query);
  const oldToken = tokens.find((row) => row.purpose === "SUPER_EMAIL_CHANGE_OLD");
  const newToken = tokens.find((row) => row.purpose === "SUPER_EMAIL_CHANGE_NEW");
  if (!oldToken || !newToken || !oldToken.used_at || !newToken.used_at) return { applied: false };
  const newEmail = normalizeEmail(oldToken.payload?.new_email);
  await SuperAdminAuthRepo.update({ email: newEmail }, query);
  await invalidateBrowserSessionsForActor({ actorType: "SUPER", actorEmail: normalizeEmail(oldToken.payload?.old_email), reason: "email_change" }).catch(() => {});
  await sendSecurityNotification({
    to: newEmail,
    subject: "PuntosFieles • Correo super admin actualizado",
    lines: ["El correo del super admin fue actualizado.", "Se invalidaron las sesiones activas."]
  });
  return { applied: true, email: newEmail };
}

export async function confirmSuperEmailChange({ token, ip = null, ua: _ua = null }) {
  const active = await AuthActionTokenRepo.lookupActiveByTokenHash(hashActionToken(token));
  if (!active || active.actor_type !== "SUPER" || !String(active.purpose || "").startsWith("SUPER_EMAIL_CHANGE_")) {
    throw badRequest("Invalid or expired email-change token");
  }
  const used = await AuthActionTokenRepo.markUsed(active.id, { confirmed: true });
  const result = await maybeApplySuperEmailChange(used.request_id);
  await logSecurity({
    event_type: "super_email_change_confirmed",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    meta: { purpose: active.purpose, request_id: active.request_id, applied: result.applied }
  });
  return { ok: true, applied: result.applied };
}

async function getStaffMfaRecord(staffId) {
  const staff = await StaffRepo.getById(staffId);
  if (!staff) throw notFound("Staff not found");
  return staff;
}

export async function startStaffMfaEnrollment({ staffId, businessId }) {
  const staff = await getStaffMfaRecord(staffId);
  const secret = generateBase32Secret();
  await dbQuery(
    `UPDATE staff_users
        SET mfa_pending_secret_enc = $2,
            mfa_pending_created_at = now()
      WHERE id = $1`,
    [staff.id, encryptSecret(secret)]
  );
  return {
    secret,
    otpauth_uri: buildOtpAuthUri({
      issuer: "PuntosFieles",
      label: normalizeEmail(staff.email || `${staff.id}@staff.local`),
      secret
    }),
    businessId
  };
}

export async function confirmStaffMfaEnrollment({ staffId, code, sessionId = null }) {
  const staff = await getStaffMfaRecord(staffId);
  const secret = decryptSecretMaybe(staff.mfa_pending_secret_enc || "");
  if (!secret) throw conflict("No pending MFA enrollment");
  if (!verifyTotp(secret, requireTotpFormat(code))) throw unauthorized("Invalid MFA code");
  await dbQuery(
    `UPDATE staff_users
        SET mfa_enabled = true,
            mfa_secret_enc = $2,
            mfa_pending_secret_enc = NULL,
            mfa_pending_created_at = NULL,
            mfa_confirmed_at = now()
      WHERE id = $1`,
    [staff.id, encryptSecret(secret)]
  );
  if (sessionId) {
    await markBrowserSessionReauthenticated({ sessionId, mfaVerified: true }).catch(() => {});
  }
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • MFA activado",
    lines: ["La autenticación multifactor fue activada para tu cuenta."]
  });
  await logSecurity({
    event_type: "staff_mfa_enabled",
    severity: "HIGH",
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id
  });
  return { ok: true };
}

export async function disableStaffMfa({ staffId }) {
  const staff = await getStaffMfaRecord(staffId);
  await dbQuery(
    `UPDATE staff_users
        SET mfa_enabled = false,
            mfa_secret_enc = NULL,
            mfa_pending_secret_enc = NULL,
            mfa_pending_created_at = NULL
      WHERE id = $1`,
    [staff.id]
  );
  await invalidateBrowserSessionsForActor({ actorType: "STAFF", actorId: staff.id, reason: "mfa_disabled" }).catch(() => {});
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • MFA desactivado",
    lines: ["La autenticación multifactor fue desactivada para tu cuenta."]
  });
  return { ok: true };
}

export async function startSuperMfaEnrollment() {
  const auth = await SuperAdminAuthRepo.getEffective();
  const secret = generateBase32Secret();
  await SuperAdminAuthRepo.update({
    mfa_pending_secret_enc: encryptSecret(secret),
    mfa_pending_created_at: new Date().toISOString()
  });
  return {
    secret,
    otpauth_uri: buildOtpAuthUri({
      issuer: "PuntosFieles",
      label: normalizeEmail(auth.email || "super-admin"),
      secret
    })
  };
}

export async function confirmSuperMfaEnrollment({ code, sessionId = null }) {
  const auth = await SuperAdminAuthRepo.getEffective();
  const secret = decryptSecretMaybe(auth.mfa_pending_secret_enc || "");
  if (!secret) throw conflict("No pending MFA enrollment");
  if (!verifyTotp(secret, requireTotpFormat(code))) throw unauthorized("Invalid MFA code");
  await SuperAdminAuthRepo.update({
    mfa_enabled: true,
    mfa_secret_enc: encryptSecret(secret),
    mfa_pending_secret_enc: null,
    mfa_pending_created_at: null,
    mfa_confirmed_at: new Date().toISOString()
  });
  if (sessionId) {
    await markBrowserSessionReauthenticated({ sessionId, mfaVerified: true }).catch(() => {});
  }
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • MFA super admin activado",
    lines: ["La autenticación multifactor fue activada para el super admin."]
  });
  return { ok: true };
}

export async function disableSuperMfa() {
  const auth = await SuperAdminAuthRepo.getEffective();
  await SuperAdminAuthRepo.update({
    mfa_enabled: false,
    mfa_secret_enc: null,
    mfa_pending_secret_enc: null,
    mfa_pending_created_at: null
  });
  await invalidateBrowserSessionsForActor({ actorType: "SUPER", actorEmail: normalizeEmail(auth.email), reason: "mfa_disabled" }).catch(() => {});
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • MFA super admin desactivado",
    lines: ["La autenticación multifactor fue desactivada para el super admin."]
  });
  return { ok: true };
}

export async function verifyStaffMfaForLogin(staff, code) {
  if (!staff?.mfa_enabled) return { ok: true };
  const secret = decryptSecretMaybe(staff.mfa_secret_enc || "");
  const normalizedCode = String(code || "").trim();
  const validCode = /^\d{6}$/.test(normalizedCode) && secret && verifyTotp(secret, normalizedCode);
  if (!validCode) {
    await logSecurity({
      event_type: "staff_mfa_failed_after_password",
      severity: "HIGH",
      business_id: staff.business_id,
      actor_type: "STAFF",
      actor_id: staff.id,
      route: "/api/staff/login",
      method: "POST",
      meta: { email: normalizeEmail(staff.email) }
    });
    await sendSecurityNotification({
      businessId: staff.business_id,
      to: staff.email,
      subject: "PuntosFieles • Falló MFA después de contraseña correcta",
      lines: ["Se ingresó la contraseña correcta para tu cuenta, pero falló el segundo factor.", "Si no fuiste tú, cambia tu contraseña."]
    });
    throw unauthorized("MFA_REQUIRED");
  }
  return { ok: true, mfaVerified: true };
}

export async function verifySuperMfaForLogin(code) {
  const auth = await SuperAdminAuthRepo.getEffective();
  if (!auth?.mfa_enabled) return { ok: true, auth };
  const secret = decryptSecretMaybe(auth.mfa_secret_enc || "");
  const normalizedCode = String(code || "").trim();
  const validCode = /^\d{6}$/.test(normalizedCode) && secret && verifyTotp(secret, normalizedCode);
  if (!validCode) {
    await logSecurity({
      event_type: "super_mfa_failed_after_password",
      severity: "HIGH",
      actor_type: "SUPER_ADMIN",
      route: "/api/super/login",
      method: "POST",
      meta: { email: normalizeEmail(auth.email) }
    });
    await sendSecurityNotification({
      to: auth.email,
      subject: "PuntosFieles • Falló MFA super admin",
      lines: ["Se ingresó la contraseña correcta del super admin, pero falló el segundo factor."]
    });
    throw unauthorized("MFA_REQUIRED");
  }
  return { ok: true, auth, mfaVerified: true };
}

export async function reauthenticateStaffSession({ staff, password, mfaCode, sessionId }) {
  const fresh = await getStaffMfaRecord(staff.id);
  const ok = await verifyPassword(password, fresh.password_hash);
  if (!ok) throw unauthorized("Invalid credentials");
  if (fresh.mfa_enabled) {
    const secret = decryptSecretMaybe(fresh.mfa_secret_enc || "");
    if (!secret || !verifyTotp(secret, requireTotpFormat(mfaCode))) throw unauthorized("Invalid MFA code");
  }
  await markBrowserSessionReauthenticated({ sessionId, mfaVerified: Boolean(fresh.mfa_enabled) });
  await logAudit({
    businessId: fresh.business_id,
    actorType: "STAFF",
    actorId: fresh.id,
    action: "staff.reauth",
    meta: { mfa_enabled: Boolean(fresh.mfa_enabled) }
  });
  return { ok: true };
}

export async function reauthenticateSuperSession({ password, mfaCode, sessionId }) {
  const auth = await SuperAdminAuthRepo.getEffective();
  const ok = auth.password_hash
    ? await verifyPassword(password, auth.password_hash)
    : false;
  if (!ok) throw unauthorized("Invalid credentials");
  if (auth.mfa_enabled) {
    const secret = decryptSecretMaybe(auth.mfa_secret_enc || "");
    if (!secret || !verifyTotp(secret, requireTotpFormat(mfaCode))) throw unauthorized("Invalid MFA code");
  }
  await markBrowserSessionReauthenticated({ sessionId, mfaVerified: Boolean(auth.mfa_enabled) });
  return { ok: true };
}

export async function lockdownStaffAccount({ staffId, ip = null, ua = null }) {
  const staff = await getStaffMfaRecord(staffId);
  const revokedSessions = await invalidateBrowserSessionsForActor({
    actorType: "STAFF",
    actorId: staff.id,
    reason: "compromised_account"
  }).catch(() => 0);
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • Sesiones revocadas por seguridad",
    lines: ["Se revocaron las sesiones activas de tu cuenta por una acción de seguridad.", "Debes volver a iniciar sesión."]
  });
  await logSecurity({
    event_type: "staff_account_lockdown",
    severity: "HIGH",
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    ip,
    meta: { revoked_sessions: revokedSessions }
  });
  await logAudit({
    businessId: staff.business_id,
    actorType: "STAFF",
    actorId: staff.id,
    action: "staff.security.lockdown",
    ip,
    ua,
    meta: { revoked_sessions: revokedSessions }
  });
  return { ok: true, revokedSessions };
}

export async function lockdownSuperAccount({ ip = null, ua = null }) {
  const auth = await SuperAdminAuthRepo.getEffective();
  const revokedSessions = await invalidateBrowserSessionsForActor({
    actorType: "SUPER",
    actorEmail: normalizeEmail(auth.email),
    reason: "compromised_account"
  }).catch(() => 0);
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • Sesiones super admin revocadas",
    lines: ["Se revocaron las sesiones activas del super admin por una acción de seguridad.", "Debes volver a iniciar sesión."]
  });
  await logSecurity({
    event_type: "super_account_lockdown",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    meta: { revoked_sessions: revokedSessions, email: normalizeEmail(auth.email) }
  });
  await logAudit({
    businessId: null,
    actorType: "SUPER_ADMIN",
    actorId: null,
    action: "super.security.lockdown",
    ip,
    ua,
    meta: { revoked_sessions: revokedSessions, email: normalizeEmail(auth.email) }
  });
  return { ok: true, revokedSessions };
}
