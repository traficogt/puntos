import crypto from "node:crypto";
import { exec, many } from "./base.js";

function id() {
  return crypto.randomUUID();
}

export const SecurityEventRepo = {
  async log({
    event_type,
    severity = "MEDIUM",
    business_id = null,
    route = null,
    method = null,
    ip = null,
    actor_type = null,
    actor_id = null,
    meta = {}
  }) {
    if (!event_type) return;
    await exec(
      `INSERT INTO security_events
       (id, event_type, severity, business_id, route, method, ip, actor_type, actor_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id(), event_type, severity, business_id, route, method, ip, actor_type, actor_id, meta || {}]
    );
  },

  async countByEventType({ hours = 24 } = {}) {
    return many(
      `SELECT event_type, COUNT(*)::int AS count
       FROM security_events
       WHERE created_at >= now() - ($1 || ' hours')::interval
       GROUP BY event_type
       ORDER BY count DESC`,
      [String(Math.max(1, Number(hours || 24)))]
    );
  },

  async listRecent({ hours = 24, limit = 30 } = {}) {
    return many(
      `SELECT id, event_type, severity, business_id, route, method, ip, actor_type, actor_id, meta, created_at
       FROM security_events
       WHERE created_at >= now() - ($1 || ' hours')::interval
       ORDER BY created_at DESC
       LIMIT $2`,
      [String(Math.max(1, Number(hours || 24))), Math.min(200, Math.max(1, Number(limit || 30)))]
    );
  }
};

