import { dbQuery } from "../../database.js";
import { SuperAdminAuthRepo } from "../../repositories/super-admin-auth-repository.js";
import {
  invalidateBrowserSessionsForActor,
  markBrowserSessionReauthenticated,
} from "../auth-session-service.js";
import { verifyPassword } from "../../../utils/password-hash.js";
import { badRequest, conflict, unauthorized } from "../../../utils/http-error.js";
import { logger } from "../../../utils/logger.js";
import { encryptSecret, decryptSecretMaybe } from "../../../utils/secret-crypto.js";
import {
  buildOtpAuthUri,
  generateBase32Secret,
  verifyTotp,
  verifyTotpCounter,
} from "../../../utils/totp.js";
import { sendSecurityNotification } from "../security-notification-service.js";
import { normalizeEmail, logAudit, logSecurity, getStaffMfaRecord } from "./shared.js";

function requireTotpFormat(code) {
  const normalized = String(code || "").trim();
  if (!/^\d{6}$/.test(normalized)) throw badRequest("Código MFA inválido", "VALIDATION_ERROR");
  return normalized;
}

// Single-use enforcement for a verified TOTP code: records the accepted time-step
// counter for this account and returns true only if it had not been used before.
// A replay of the same code for the SAME operation (accountType namespaces login
// vs reauth) within its validity window returns false. The table
// has no RLS and no business_id, so this works during login before tenant context.
async function consumeTotpCounter(accountType, accountId, counter) {
  if (counter === null || counter === undefined) return false;
  const { rowCount } = await dbQuery(
    `INSERT INTO mfa_used_counters (account_type, account_id, counter)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [accountType, String(accountId), Number(counter)],
  );
  return rowCount === 1;
}

// Daily maintenance: a used-counter row only matters while its TOTP code could
// still validate (±1 step ≈ 90s), so rows well past that are dead weight. Prune
// them so the table stays bounded. Not tenant-scoped — no RLS/business context.
export async function pruneExpiredMfaCounters({ olderThan = "1 day" } = {}) {
  const { rowCount } = await dbQuery(
    "DELETE FROM mfa_used_counters WHERE used_at < now() - $1::interval",
    [olderThan],
  );
  return rowCount ?? 0;
}

export async function startStaffMfaEnrollment({ staffId, businessId }) {
  const staff = await getStaffMfaRecord(staffId);
  const secret = generateBase32Secret();
  await dbQuery(
    `UPDATE staff_users
        SET mfa_pending_secret_enc = $2,
            mfa_pending_created_at = now()
      WHERE id = $1`,
    [staff.id, encryptSecret(secret)],
  );
  return {
    secret,
    otpauth_uri: buildOtpAuthUri({
      issuer: "PuntosFieles",
      label: normalizeEmail(staff.email || `${staff.id}@staff.local`),
      secret,
    }),
    businessId,
  };
}

export async function confirmStaffMfaEnrollment({ staffId, code, sessionId = null }) {
  const staff = await getStaffMfaRecord(staffId);
  const secret = decryptSecretMaybe(staff.mfa_pending_secret_enc || "");
  if (!secret) throw conflict("No hay una activación de MFA pendiente");
  if (!verifyTotp(secret, requireTotpFormat(code)))
    throw unauthorized("Código MFA inválido", "VALIDATION_ERROR");
  await dbQuery(
    `UPDATE staff_users
        SET mfa_enabled = true,
            mfa_secret_enc = $2,
            mfa_pending_secret_enc = NULL,
            mfa_pending_created_at = NULL,
            mfa_confirmed_at = now()
      WHERE id = $1`,
    [staff.id, encryptSecret(secret)],
  );
  if (sessionId) {
    await markBrowserSessionReauthenticated({ sessionId, mfaVerified: true }).catch(() => {});
  }
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • MFA activado",
    lines: ["La autenticación multifactor fue activada para tu cuenta."],
  });
  await logSecurity({
    event_type: "staff_mfa_enabled",
    severity: "HIGH",
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
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
    [staff.id],
  );
  await invalidateBrowserSessionsForActor({
    actorType: "STAFF",
    actorId: staff.id,
    reason: "mfa_disabled",
  }).catch((err) =>
    logger.warn(
      { err, reason: "mfa_disabled" },
      "Browser session invalidation failed after security change",
    ),
  );
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • MFA desactivado",
    lines: ["La autenticación multifactor fue desactivada para tu cuenta."],
  });
  return { ok: true };
}

export async function startSuperMfaEnrollment() {
  const auth = await SuperAdminAuthRepo.getEffective();
  const secret = generateBase32Secret();
  await SuperAdminAuthRepo.update({
    mfa_pending_secret_enc: encryptSecret(secret),
    mfa_pending_created_at: new Date().toISOString(),
  });
  return {
    secret,
    otpauth_uri: buildOtpAuthUri({
      issuer: "PuntosFieles",
      label: normalizeEmail(auth.email || "super-admin"),
      secret,
    }),
  };
}

export async function confirmSuperMfaEnrollment({ code, sessionId = null }) {
  const auth = await SuperAdminAuthRepo.getEffective();
  const secret = decryptSecretMaybe(auth.mfa_pending_secret_enc || "");
  if (!secret) throw conflict("No hay una activación de MFA pendiente");
  if (!verifyTotp(secret, requireTotpFormat(code)))
    throw unauthorized("Código MFA inválido", "VALIDATION_ERROR");
  await SuperAdminAuthRepo.update({
    mfa_enabled: true,
    mfa_secret_enc: encryptSecret(secret),
    mfa_pending_secret_enc: null,
    mfa_pending_created_at: null,
    mfa_confirmed_at: new Date().toISOString(),
  });
  if (sessionId) {
    await markBrowserSessionReauthenticated({ sessionId, mfaVerified: true }).catch(() => {});
  }
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • MFA super admin activado",
    lines: ["La autenticación multifactor fue activada para el super admin."],
  });
  return { ok: true };
}

export async function disableSuperMfa() {
  const auth = await SuperAdminAuthRepo.getEffective();
  await SuperAdminAuthRepo.update({
    mfa_enabled: false,
    mfa_secret_enc: null,
    mfa_pending_secret_enc: null,
    mfa_pending_created_at: null,
  });
  await invalidateBrowserSessionsForActor({
    actorType: "SUPER",
    actorEmail: normalizeEmail(auth.email),
    reason: "mfa_disabled",
  }).catch((err) =>
    logger.warn(
      { err, reason: "mfa_disabled" },
      "Browser session invalidation failed after security change",
    ),
  );
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • MFA super admin desactivado",
    lines: ["La autenticación multifactor fue desactivada para el super admin."],
  });
  return { ok: true };
}

export async function verifyStaffMfaForLogin(staff, code) {
  if (!staff?.mfa_enabled) return { ok: true };
  const secret = decryptSecretMaybe(staff.mfa_secret_enc || "");
  const normalizedCode = String(code || "").trim();
  const counter = secret ? verifyTotpCounter(secret, normalizedCode) : null;
  const validCode =
    counter !== null && (await consumeTotpCounter("STAFF_LOGIN", staff.id, counter));
  if (!validCode) {
    await logSecurity({
      event_type: "staff_mfa_failed_after_password",
      severity: "HIGH",
      business_id: staff.business_id,
      actor_type: "STAFF",
      actor_id: staff.id,
      route: "/api/staff/login",
      method: "POST",
      meta: { email: normalizeEmail(staff.email) },
    });
    await sendSecurityNotification({
      businessId: staff.business_id,
      to: staff.email,
      subject: "PuntosFieles • Falló MFA después de contraseña correcta",
      lines: [
        "Se ingresó la contraseña correcta para tu cuenta, pero falló el segundo factor.",
        "Si no fuiste tú, cambia tu contraseña.",
      ],
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
  const counter = secret ? verifyTotpCounter(secret, normalizedCode) : null;
  const validCode = counter !== null && (await consumeTotpCounter("SUPER_LOGIN", "SUPER", counter));
  if (!validCode) {
    await logSecurity({
      event_type: "super_mfa_failed_after_password",
      severity: "HIGH",
      actor_type: "SUPER_ADMIN",
      route: "/api/super/login",
      method: "POST",
      meta: { email: normalizeEmail(auth.email) },
    });
    await sendSecurityNotification({
      to: auth.email,
      subject: "PuntosFieles • Falló MFA super admin",
      lines: ["Se ingresó la contraseña correcta del super admin, pero falló el segundo factor."],
    });
    throw unauthorized("MFA_REQUIRED");
  }
  return { ok: true, auth, mfaVerified: true };
}

export async function reauthenticateStaffSession({ staff, password, mfaCode, sessionId }) {
  const fresh = await getStaffMfaRecord(staff.id);
  const ok = await verifyPassword(password, fresh.password_hash);
  if (!ok) throw unauthorized("Credenciales inválidas", "VALIDATION_ERROR");
  if (fresh.mfa_enabled) {
    const secret = decryptSecretMaybe(fresh.mfa_secret_enc || "");
    const counter = secret ? verifyTotpCounter(secret, requireTotpFormat(mfaCode)) : null;
    if (counter === null || !(await consumeTotpCounter("STAFF_REAUTH", fresh.id, counter)))
      throw unauthorized("Código MFA inválido", "VALIDATION_ERROR");
  }
  await markBrowserSessionReauthenticated({ sessionId, mfaVerified: Boolean(fresh.mfa_enabled) });
  await logAudit({
    businessId: fresh.business_id,
    actorType: "STAFF",
    actorId: fresh.id,
    action: "staff.reauth",
    meta: { mfa_enabled: Boolean(fresh.mfa_enabled) },
  });
  return { ok: true };
}

export async function reauthenticateSuperSession({ password, mfaCode, sessionId }) {
  const auth = await SuperAdminAuthRepo.getEffective();
  const ok = auth.password_hash ? await verifyPassword(password, auth.password_hash) : false;
  if (!ok) throw unauthorized("Credenciales inválidas", "VALIDATION_ERROR");
  if (auth.mfa_enabled) {
    const secret = decryptSecretMaybe(auth.mfa_secret_enc || "");
    const counter = secret ? verifyTotpCounter(secret, requireTotpFormat(mfaCode)) : null;
    if (counter === null || !(await consumeTotpCounter("SUPER_REAUTH", "SUPER", counter)))
      throw unauthorized("Código MFA inválido", "VALIDATION_ERROR");
  }
  await markBrowserSessionReauthenticated({ sessionId, mfaVerified: Boolean(auth.mfa_enabled) });
  return { ok: true };
}
