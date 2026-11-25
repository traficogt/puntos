import { SuperAdminAuthRepo } from "../../repositories/super-admin-auth-repository.js";
import { invalidateBrowserSessionsForActor } from "../auth-session-service.js";
import { sendSecurityNotification } from "../security-notification-service.js";
import { normalizeEmail, logAudit, logSecurity, getStaffMfaRecord } from "./shared.js";

/** @param {{ staffId: string, ip?: string | null, ua?: string | null }} input */
export async function lockdownStaffAccount({ staffId, ip = null, ua = null }) {
  const staff = await getStaffMfaRecord(staffId);
  const revokedSessions = await invalidateBrowserSessionsForActor({
    actorType: "STAFF",
    actorId: staff.id,
    reason: "compromised_account",
  }).catch(() => 0);
  await sendSecurityNotification({
    businessId: staff.business_id,
    to: staff.email,
    subject: "PuntosFieles • Sesiones revocadas por seguridad",
    lines: [
      "Se revocaron las sesiones activas de tu cuenta por una acción de seguridad.",
      "Debes volver a iniciar sesión.",
    ],
  });
  await logSecurity({
    event_type: "staff_account_lockdown",
    severity: "HIGH",
    business_id: staff.business_id,
    actor_type: "STAFF",
    actor_id: staff.id,
    ip,
    meta: { revoked_sessions: revokedSessions },
  });
  await logAudit({
    businessId: staff.business_id,
    actorType: "STAFF",
    actorId: staff.id,
    action: "staff.security.lockdown",
    ip,
    ua,
    meta: { revoked_sessions: revokedSessions },
  });
  return { ok: true, revokedSessions };
}

/** @param {{ ip?: string | null, ua?: string | null }} input */
export async function lockdownSuperAccount({ ip = null, ua = null }) {
  const auth = await SuperAdminAuthRepo.getEffective();
  const revokedSessions = await invalidateBrowserSessionsForActor({
    actorType: "SUPER",
    actorEmail: normalizeEmail(auth.email),
    reason: "compromised_account",
  }).catch(() => 0);
  await sendSecurityNotification({
    to: auth.email,
    subject: "PuntosFieles • Sesiones super admin revocadas",
    lines: [
      "Se revocaron las sesiones activas del super admin por una acción de seguridad.",
      "Debes volver a iniciar sesión.",
    ],
  });
  // The super admin has no tenant and audit_logs.business_id is NOT NULL, so the
  // platform-level record lives only in security_events (nullable business_id);
  // the user agent rides in meta because that table has no ua column.
  await logSecurity({
    event_type: "super_account_lockdown",
    severity: "HIGH",
    actor_type: "SUPER_ADMIN",
    ip,
    meta: { revoked_sessions: revokedSessions, email: normalizeEmail(auth.email), ua },
  });
  return { ok: true, revokedSessions };
}
