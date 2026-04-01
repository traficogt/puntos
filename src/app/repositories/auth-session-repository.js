import { dbQuery } from "../database.js";

export const AuthSessionRepo = {
  async create({
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
    meta = {}
  }, query = dbQuery) {
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
        meta
      ]
    );
    return { id };
  },

  async lookupByTokenHash(sessionTokenHash, query = dbQuery) {
    const { rows } = await query(
      `SELECT *
         FROM app.auth_session_lookup($1)`,
      [sessionTokenHash]
    );
    return rows[0] ?? null;
  },

  async touchById(id, idleExpiresAt, query = dbQuery) {
    await query(
      `SELECT app.auth_session_touch($1, $2)`,
      [id, idleExpiresAt]
    );
    return { id, idle_expires_at: idleExpiresAt };
  },

  async markReauthenticatedById(id, { mfaVerified = false } = {}, query = dbQuery) {
    await query(`SELECT app.auth_session_mark_reauthenticated($1, $2)`, [id, Boolean(mfaVerified)]);
    return { id };
  },

  async invalidateById(id, reason, query = dbQuery) {
    await query(
      `SELECT app.auth_session_invalidate_by_id($1, $2)`,
      [id, reason ?? null]
    );
    return { id, invalidation_reason: reason ?? null };
  },

  async invalidateByActor({ actorType, actorId = null, actorEmail = null, reason }, query = dbQuery) {
    const { rows } = await query(
      `SELECT app.auth_session_invalidate_by_actor($1, $2, $3, $4) AS count`,
      [actorType, actorId, actorEmail, reason ?? null]
    );
    return Number(rows[0]?.count || 0);
  }
};
