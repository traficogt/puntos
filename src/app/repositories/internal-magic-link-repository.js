import { dbQuery } from "../database.js";

export const InternalMagicLinkRepo = {
  async create(record, query = dbQuery) {
    await query(
      `INSERT INTO internal_magic_links
       (id, actor_type, actor_id, business_id, target, usage_mode, purpose, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        record.id,
        record.actor_type,
        record.actor_id,
        record.business_id,
        record.target,
        record.usage_mode,
        record.purpose,
        record.token_hash,
        record.created_by ?? null,
        record.expires_at
      ]
    );
    return { id: record.id };
  },

  async lookupByTokenHash(tokenHash, query = dbQuery) {
    const { rows } = await query(
      `SELECT *
         FROM internal_magic_links
        WHERE token_hash = $1
          AND expires_at > now()
        LIMIT 1`,
      [tokenHash]
    );
    return rows[0] ?? null;
  },

  async consumeSingleUse(id, consumedMeta = {}, query = dbQuery) {
    const { rows } = await query(
      `UPDATE internal_magic_links
          SET used_at = now(),
              used_count = used_count + 1,
              used_ip = COALESCE($2::text, used_ip),
              used_ua = COALESCE($3::text, used_ua)
        WHERE id = $1
          AND usage_mode = 'single_use'
          AND expires_at > now()
          AND used_at IS NULL
      RETURNING *`,
      [id, consumedMeta.ip ?? consumedMeta.used_ip ?? null, consumedMeta.ua ?? consumedMeta.used_ua ?? null]
    );
    return rows[0] ?? null;
  },

  async touchReusable(id, consumedMeta = {}, query = dbQuery) {
    const { rows } = await query(
      `UPDATE internal_magic_links
          SET used_at = now(),
              used_count = used_count + 1,
              used_ip = COALESCE($2::text, used_ip),
              used_ua = COALESCE($3::text, used_ua)
        WHERE id = $1
          AND usage_mode = 'reusable_window'
          AND expires_at > now()
      RETURNING *`,
      [id, consumedMeta.ip ?? consumedMeta.used_ip ?? null, consumedMeta.ua ?? consumedMeta.used_ua ?? null]
    );
    return rows[0] ?? null;
  }
};
