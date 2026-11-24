import { dbQuery } from "../database.js";

/**
 * Row of `auth_sessions` (also the shape returned by `app.auth_session_lookup`).
 * @typedef {{
 *   id: string,
 *   session_token_hash: string,
 *   actor_type: "STAFF" | "CUSTOMER" | "SUPER",
 *   actor_id: string | null,
 *   actor_email: string | null,
 *   business_id: string | null,
 *   role: string | null,
 *   branch_id: string | null,
 *   impersonated_by: string | null,
 *   meta: Record<string, unknown>,
 *   last_seen_at: Date,
 *   idle_expires_at: Date,
 *   absolute_expires_at: Date,
 *   invalidated_at: Date | null,
 *   invalidation_reason: string | null,
 *   reauth_verified_at: Date | null,
 *   mfa_verified_at: Date | null,
 *   created_at: Date
 * }} AuthSessionRow
 */

export const AuthSessionRepo = {
  /**
   * @param {{
   *   id: string,
   *   session_token_hash: string,
   *   actor_type: string,
   *   actor_id: string | null,
   *   actor_email: string | null,
   *   business_id: string | null,
   *   role: string | null,
   *   branch_id: string | null,
   *   impersonated_by: string | null,
   *   reauth_verified_at?: string | null,
   *   mfa_verified_at?: string | null,
   *   idle_expires_at: string,
   *   absolute_expires_at: string,
   *   meta?: object
   * }} session
   * @param {typeof dbQuery} [query]
   */
  async create(
    {
      id,
      session_token_hash,
      actor_type,
      actor_id,
      actor_email,
      business_id,
      role,
      branch_id,
      impersonated_by,
      reauth_verified_at = null,
      mfa_verified_at = null,
      idle_expires_at,
      absolute_expires_at,
      meta = {},
    },
    query = dbQuery,
  ) {
    await query(
      `INSERT INTO auth_sessions (
         id,
         session_token_hash,
         actor_type,
         actor_id,
         actor_email,
         business_id,
         role,
         branch_id,
         impersonated_by,
         reauth_verified_at,
         mfa_verified_at,
         idle_expires_at,
         absolute_expires_at,
         meta
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       `,
      [
        id,
        session_token_hash,
        actor_type,
        actor_id ?? null,
        actor_email ?? null,
        business_id ?? null,
        role ?? null,
        branch_id ?? null,
        impersonated_by ?? null,
        reauth_verified_at ?? null,
        mfa_verified_at ?? null,
        idle_expires_at,
        absolute_expires_at,
        meta,
      ],
    );
    return { id };
  },

  /**
   * Resolves to `AuthSessionRow | null`.
   * @param {string} sessionTokenHash
   * @param {typeof dbQuery} [query]
   */
  async lookupByTokenHash(sessionTokenHash, query = dbQuery) {
    const { rows } = await query(
      `SELECT *
         FROM app.auth_session_lookup($1)`,
      [sessionTokenHash],
    );
    return rows[0] ?? null;
  },

  /**
   * @param {string} id
   * @param {string | Date} idleExpiresAt
   * @param {typeof dbQuery} [query]
   */
  async touchById(id, idleExpiresAt, query = dbQuery) {
    await query(`SELECT app.auth_session_touch($1, $2)`, [id, idleExpiresAt]);
    return { id, idle_expires_at: idleExpiresAt };
  },

  /**
   * @param {string} id
   * @param {{ mfaVerified?: boolean }} [options]
   * @param {typeof dbQuery} [query]
   */
  async markReauthenticatedById(id, { mfaVerified = false } = {}, query = dbQuery) {
    await query(`SELECT app.auth_session_mark_reauthenticated($1, $2)`, [id, Boolean(mfaVerified)]);
    return { id };
  },

  /**
   * @param {string} id
   * @param {string | null} [reason]
   * @param {typeof dbQuery} [query]
   */
  async invalidateById(id, reason, query = dbQuery) {
    await query(`SELECT app.auth_session_invalidate_by_id($1, $2)`, [id, reason ?? null]);
    return { id, invalidation_reason: reason ?? null };
  },

  /**
   * @param {{
   *   actorType: string,
   *   actorId?: string | null,
   *   actorEmail?: string | null,
   *   reason?: string | null
   * }} actor
   * @param {typeof dbQuery} [query]
   */
  async invalidateByActor(
    { actorType, actorId = null, actorEmail = null, reason },
    query = dbQuery,
  ) {
    const { rows } = await query(
      `SELECT app.auth_session_invalidate_by_actor($1, $2, $3, $4) AS count`,
      [actorType, actorId, actorEmail, reason ?? null],
    );
    return Number(rows[0]?.count || 0);
  },
};
