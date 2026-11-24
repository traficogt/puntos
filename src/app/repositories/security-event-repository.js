import crypto from "node:crypto";
import { exec, many } from "./base.js";

/**
 * Row of `security_events`.
 * @typedef {{
 *   id: string,
 *   event_type: string,
 *   severity: string,
 *   business_id: string | null,
 *   route: string | null,
 *   method: string | null,
 *   ip: string | null,
 *   actor_type: string | null,
 *   actor_id: string | null,
 *   meta: Record<string, unknown>,
 *   created_at: Date
 * }} SecurityEventRow
 */

/**
 * @typedef {{
 *   event_type: string,
 *   severity?: string,
 *   business_id?: string | null,
 *   route?: string | null,
 *   method?: string | null,
 *   ip?: string | null,
 *   actor_type?: string | null,
 *   actor_id?: string | null,
 *   meta?: Record<string, unknown>
 * }} SecurityEventInput
 */

function id() {
  return crypto.randomUUID();
}

export const SecurityEventRepo = {
  /** @param {SecurityEventInput} event */
  async log({
    event_type,
    severity = "MEDIUM",
    business_id = null,
    route = null,
    method = null,
    ip = null,
    actor_type = null,
    actor_id = null,
    meta = {},
  }) {
    if (!event_type) return;
    await exec(
      `INSERT INTO security_events
       (id, event_type, severity, business_id, route, method, ip, actor_type, actor_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id(),
        event_type,
        severity,
        business_id,
        route,
        method,
        ip,
        actor_type,
        actor_id,
        meta || {},
      ],
    );
  },

  /**
   * Writes through the privileged `app.security_event_log` function (no tenant context required).
   * @param {SecurityEventInput} event
   */
  async logPrivileged({
    event_type,
    severity = "MEDIUM",
    business_id = null,
    route = null,
    method = null,
    ip = null,
    actor_type = null,
    actor_id = null,
    meta = {},
  }) {
    if (!event_type) return;
    await exec(`SELECT app.security_event_log($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [
      id(),
      event_type,
      severity,
      business_id,
      route,
      method,
      ip,
      actor_type,
      actor_id,
      JSON.stringify(meta || {}),
    ]);
  },

  /**
   * @param {{ hours?: number }} [window]
   * @returns {Promise<Array<{ event_type: string, count: number }>>}
   */
  async countByEventType({ hours = 24 } = {}) {
    return many(
      `SELECT event_type, COUNT(*)::int AS count
       FROM security_events
       WHERE created_at >= now() - ($1 || ' hours')::interval
       GROUP BY event_type
       ORDER BY count DESC`,
      [String(Math.max(1, Number(hours || 24)))],
    );
  },

  /**
   * Resolves to `SecurityEventRow[]`.
   * @param {{ hours?: number, limit?: number }} [window]
   */
  async listRecent({ hours = 24, limit = 30 } = {}) {
    return many(
      `SELECT id, event_type, severity, business_id, route, method, ip, actor_type, actor_id, meta, created_at
       FROM security_events
       WHERE created_at >= now() - ($1 || ' hours')::interval
       ORDER BY created_at DESC
       LIMIT $2`,
      [String(Math.max(1, Number(hours || 24))), Math.min(200, Math.max(1, Number(limit || 30)))],
    );
  },
};
