import { exec } from "./base.js";

/**
 * Row of `audit_logs`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   actor_type: string,
 *   actor_id: string | null,
 *   action: string,
 *   ip: string | null,
 *   ua: string | null,
 *   meta: Record<string, unknown>,
 *   created_at: Date
 * }} AuditLogRow
 */

/**
 * Entry accepted by {@link AuditRepo.log}; `meta` is serialised to jsonb.
 * `business_id` is required: the column is NOT NULL, so a null insert fails at
 * runtime. Platform-level events go to `security_events` (nullable business_id).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   actor_type: string,
 *   actor_id?: string | null,
 *   action: string,
 *   ip?: string | null,
 *   ua?: string | null,
 *   meta?: Record<string, unknown> | null
 * }} AuditLogInput
 */

export const AuditRepo = {
  /** @param {AuditLogInput} entry */
  async log({ id, business_id, actor_type, actor_id, action, ip, ua, meta }) {
    // Fail before the insert: a null id would only surface as a 23502 from Postgres, and
    // callers that log and continue (logAudit) would hide it. The typedef requires the
    // id; this keeps untyped JavaScript callers honest at runtime too.
    if (!business_id) {
      throw new Error(
        `audit_logs.business_id is required for "${action}"; platform-level events belong in security_events`,
      );
    }
    await exec(
      `INSERT INTO audit_logs (id, business_id, actor_type, actor_id, action, ip, ua, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        business_id,
        actor_type,
        actor_id ?? null,
        action,
        ip ?? null,
        ua ?? null,
        JSON.stringify(meta ?? {}),
      ],
    );
  },
};
