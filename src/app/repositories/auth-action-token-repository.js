import { dbQuery } from "../database.js";

/**
 * Row of `auth_action_tokens`.
 * @typedef {{
 *   id: string,
 *   request_id: string | null,
 *   actor_type: "STAFF" | "SUPER",
 *   actor_id: string | null,
 *   actor_email: string | null,
 *   business_id: string | null,
 *   purpose: string,
 *   token_hash: string,
 *   payload: Record<string, unknown>,
 *   expires_at: Date,
 *   used_at: Date | null,
 *   consumed_meta: Record<string, unknown> | null,
 *   created_at: Date
 * }} AuthActionTokenRow
 */

export const AuthActionTokenRepo = {
  /**
   * @param {{
   *   id: string,
   *   request_id?: string | null,
   *   actor_type: string,
   *   actor_id?: string | null,
   *   actor_email?: string | null,
   *   business_id?: string | null,
   *   purpose: string,
   *   token_hash: string,
   *   payload?: Record<string, unknown>,
   *   expires_at: string | Date
   * }} token
   * @param {typeof dbQuery} [query]
   */
  async create(
    {
      id,
      request_id = null,
      actor_type,
      actor_id = null,
      actor_email = null,
      business_id = null,
      purpose,
      token_hash,
      payload = {},
      expires_at,
    },
    query = dbQuery,
  ) {
    await query(
      `INSERT INTO auth_action_tokens
       (id, request_id, actor_type, actor_id, actor_email, business_id, purpose, token_hash, payload, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        request_id,
        actor_type,
        actor_id,
        actor_email,
        business_id,
        purpose,
        token_hash,
        payload,
        expires_at,
      ],
    );
    return { id };
  },

  /**
   * Resolves to `AuthActionTokenRow | null`.
   * @param {string} tokenHash
   * @param {typeof dbQuery} [query]
   */
  async lookupActiveByTokenHash(tokenHash, query = dbQuery) {
    const { rows } = await query(
      `SELECT *
         FROM auth_action_tokens
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  /**
   * Resolves to `AuthActionTokenRow | null`.
   * @param {string} id
   * @param {Record<string, unknown>} [consumedMeta]
   * @param {typeof dbQuery} [query]
   */
  async markUsed(id, consumedMeta = {}, query = dbQuery) {
    const { rows } = await query(
      `UPDATE auth_action_tokens
          SET used_at = now(),
              consumed_meta = $2::jsonb
        WHERE id = $1
          AND used_at IS NULL
      RETURNING *`,
      [id, JSON.stringify(consumedMeta || {})],
    );
    return rows[0] ?? null;
  },

  /**
   * Resolves to `AuthActionTokenRow[]`.
   * @param {string} requestId
   * @param {typeof dbQuery} [query]
   */
  async listByRequestId(requestId, query = dbQuery) {
    const { rows } = await query(
      `SELECT *
         FROM auth_action_tokens
        WHERE request_id = $1
        ORDER BY created_at ASC`,
      [requestId],
    );
    return rows;
  },

  /**
   * @param {{
   *   actorType: string,
   *   actorId?: string | null,
   *   actorEmail?: string | null,
   *   purpose?: string | null
   * }} actor
   * @param {typeof dbQuery} [query]
   */
  async invalidateByActor(
    { actorType, actorId = null, actorEmail = null, purpose = null },
    query = dbQuery,
  ) {
    const { rowCount } = await query(
      `UPDATE auth_action_tokens
          SET used_at = now(),
              consumed_meta = COALESCE(consumed_meta, '{}'::jsonb) || jsonb_build_object('invalidated', true)
        WHERE used_at IS NULL
          AND actor_type = $1
          AND ($2::uuid IS NULL OR actor_id = $2)
          AND ($3::text IS NULL OR actor_email = $3)
          AND ($4::text IS NULL OR purpose = $4)`,
      [actorType, actorId, actorEmail, purpose],
    );
    return Number(rowCount || 0);
  },
};
