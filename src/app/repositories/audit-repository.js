import { exec } from "./base.js";

export const AuditRepo = {
  async log({ id, business_id, actor_type, actor_id, action, ip, ua, meta }) {
    await exec(
      `INSERT INTO audit_logs (id, business_id, actor_type, actor_id, action, ip, ua, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, business_id, actor_type, actor_id ?? null, action, ip ?? null, ua ?? null, JSON.stringify(meta ?? {})]
    );
  }
};
