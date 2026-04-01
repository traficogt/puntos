import { dbQuery } from "../database.js";

export const AuthActionTokenRepo = {
  async create({
    id,
    request_id = null,
    actor_type,
    actor_id = null,
    actor_email = null,
    business_id = null,
    purpose,
    token_hash,
    payload = {},
    expires_at
  }, query = dbQuery) {
    await query(
      `INSERT INTO auth_action_tokens
       (id, request_id, actor_type, actor_id, actor_email, business_id, purpose, token_hash, payload, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, request_id, actor_type, actor_id, actor_email, business_id, purpose, token_hash, payload, expires_at]
    );
    return { id };
  },

  async lookupActiveByTokenHash(tokenHash, query = dbQuery) {
    const { rows } = await query(
      `SELECT *
         FROM auth_action_tokens
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        LIMIT 1`,
      [tokenHash]
    );
    return rows[0] ?? null;
  },

  async markUsed(id, consumedMeta = {}, query = dbQuery) {
    const { rows } = await query(
      `UPDATE auth_action_tokens
          SET used_at = now(),
              consumed_meta = $2::jsonb
        WHERE id = $1
          AND used_at IS NULL
      RETURNING *`,
      [id, JSON.stringify(consumedMeta || {})]
    );
    return rows[0] ?? null;
  },

  async listByRequestId(requestId, query = dbQuery) {
    const { rows } = await query(
      `SELECT *
         FROM auth_action_tokens
        WHERE request_id = $1
        ORDER BY created_at ASC`,
      [requestId]
    );
    return rows;
  },

  async invalidateByActor({ actorType, actorId = null, actorEmail = null, purpose = null }, query = dbQuery) {
    const { rowCount } = await query(
      `UPDATE auth_action_tokens
          SET used_at = now(),
              consumed_meta = COALESCE(consumed_meta, '{}'::jsonb) || jsonb_build_object('invalidated', true)
        WHERE used_at IS NULL
          AND actor_type = $1
          AND ($2::uuid IS NULL OR actor_id = $2)
          AND ($3::text IS NULL OR actor_email = $3)
          AND ($4::text IS NULL OR purpose = $4)`,
      [actorType, actorId, actorEmail, purpose]
    );
    return Number(rowCount || 0);
  }
};
