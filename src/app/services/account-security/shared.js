import crypto from "node:crypto";

import { StaffRepo } from "../../repositories/staff-repository.js";
import { SecurityEventRepo } from "../../repositories/security-event-repository.js";
import { AuditRepo } from "../../repositories/audit-repository.js";
import { notFound } from "../../../utils/http-error.js";
import { logger } from "../../../utils/logger.js";

export function id() {
  return crypto.randomUUID();
}

export function hashActionToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""), "utf8")
    .digest("hex");
}

export function randomActionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export async function logAudit({
  businessId = null,
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

export async function logSecurity(event) {
  await SecurityEventRepo.logPrivileged(event).catch((err) =>
    logger.warn({ err, eventType: event?.event_type }, "Security event write failed"),
  );
}

export async function getStaffMfaRecord(staffId) {
  const staff = await StaffRepo.getById(staffId);
  if (!staff) throw notFound("Staff no encontrado");
  return staff;
}
