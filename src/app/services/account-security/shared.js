import crypto from "node:crypto";

import { StaffRepo } from "../../repositories/staff-repository.js";
import { SecurityEventRepo } from "../../repositories/security-event-repository.js";
import { AuditRepo } from "../../repositories/audit-repository.js";
import { notFound } from "../../../utils/http-error.js";
import { logger } from "../../../utils/logger.js";

/**
 * Staff row as the account-security flows read it (StaffRepo.getById / getByEmail).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   email: string | null,
 *   name?: string | null,
 *   phone?: string | null,
 *   active?: boolean,
 *   password_hash?: string | null,
 *   mfa_enabled?: boolean,
 *   mfa_secret_enc?: string | null,
 *   mfa_pending_secret_enc?: string | null,
 * }} AccountSecurityStaffRecord
 */

/**
 * Super-admin auth row (SuperAdminAuthRepo.getEffective).
 * @typedef {{
 *   email: string | null,
 *   password_hash?: string | null,
 *   mfa_enabled?: boolean,
 *   mfa_secret_enc?: string | null,
 *   mfa_pending_secret_enc?: string | null,
 * }} AccountSecuritySuperAuthRecord
 */

/**
 * Row of auth_action_tokens as AuthActionTokenRepo returns it.
 * @typedef {{
 *   id: string,
 *   request_id: string | null,
 *   actor_type: string,
 *   actor_id: string | null,
 *   actor_email: string | null,
 *   business_id: string | null,
 *   purpose: string,
 *   payload: Record<string, unknown> | null,
 *   used_at: string | Date | null,
 * }} AccountSecurityActionToken
 */

/**
 * Privileged security event (SecurityEventRepo.logPrivileged input).
 * @typedef {{
 *   event_type: string,
 *   severity?: string,
 *   business_id?: string | null,
 *   route?: string | null,
 *   method?: string | null,
 *   ip?: string | null,
 *   actor_type?: string | null,
 *   actor_id?: string | null,
 *   meta?: Record<string, unknown>,
 * }} AccountSecurityEvent
 */

export function id() {
  return crypto.randomUUID();
}

/** @param {string} token */
export function hashActionToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""), "utf8")
    .digest("hex");
}

export function randomActionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/** @param {unknown} value */
export function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Tenant-scoped audit entry. `audit_logs.business_id` is NOT NULL, so every
 * caller must supply the business; platform-level (super admin) events belong
 * in `security_events` via {@link logSecurity}, whose business_id is nullable.
 * @param {{
 *   businessId: string,
 *   actorType: string,
 *   actorId?: string | null,
 *   action: string,
 *   meta?: Record<string, unknown>,
 *   ip?: string | null,
 *   ua?: string | null,
 * }} entry
 */
export async function logAudit({
  businessId,
  actorType,
  actorId = null,
  action,
  meta = {},
  ip = null,
  ua = null,
}) {
  await AuditRepo.log({
    id: id(),
    business_id: businessId,
    actor_type: actorType,
    actor_id: actorId,
    action,
    ip,
    ua,
    meta,
  }).catch((err) => logger.warn({ err, action }, "Audit log write failed"));
}

/** @param {AccountSecurityEvent} event */
export async function logSecurity(event) {
  // logPrivileged's `= null` destructuring defaults make TS infer null-only
  // members; the event shape above is what the repository actually accepts.
  await SecurityEventRepo.logPrivileged(
    /** @type {Parameters<typeof SecurityEventRepo.logPrivileged>[0]} */ (event),
  ).catch((err) =>
    logger.warn({ err, eventType: event?.event_type }, "Security event write failed"),
  );
}

/**
 * @param {string} staffId
 * @returns {Promise<AccountSecurityStaffRecord>}
 */
export async function getStaffMfaRecord(staffId) {
  const staff = await StaffRepo.getById(staffId);
  if (!staff) throw notFound("Staff no encontrado");
  return staff;
}
