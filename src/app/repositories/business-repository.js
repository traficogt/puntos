import { one, exec } from "./base.js";
import { decryptProgramSecrets, encryptProgramSecrets, rotateProgramSecretsToCurrent } from "../../utils/program-secrets.js";

function normalizeBusinessRecord(record) {
  if (!record) return record;
  return {
    ...record,
    program_json: decryptProgramSecrets(record.program_json)
  };
}

export const BusinessRepo = {
  async create({ id, name, slug, email, phone, password_hash, category, plan, program_type, program_json }) {
    const storedProgram = encryptProgramSecrets(program_json);
    return normalizeBusinessRecord(await one(
      `INSERT INTO businesses (id, name, slug, email, phone, password_hash, category, plan, program_type, program_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [id, name, slug, email, phone ?? null, password_hash, category ?? null, plan, program_type, storedProgram]
    ));
  },

  async getById(id) {
    return normalizeBusinessRecord(await one(`SELECT * FROM businesses WHERE id=$1`, [id]));
  },

  async getByEmail(email) {
    return normalizeBusinessRecord(await one(`SELECT * FROM businesses WHERE email=$1`, [email]));
  },

  async getBySlug(slug) {
    return normalizeBusinessRecord(await one(`SELECT * FROM businesses WHERE slug=$1`, [slug]));
  },

  // Public, non-sensitive lookup for join flows (no password_hash/email).
  async getPublicBySlug(slug) {
    return one(
      `SELECT business_id AS id, slug, name, category, program_type, program_json
       FROM business_public
       WHERE slug=$1`,
      [slug]
    );
  },

  async countRewards(businessId) {
    const r = await one(`SELECT COUNT(*)::int AS c FROM rewards WHERE business_id=$1`, [businessId]);
    return r?.c ?? 0;
  },

  async countBranches(businessId) {
    const r = await one(`SELECT COUNT(*)::int AS c FROM branches WHERE business_id=$1`, [businessId]);
    return r?.c ?? 0;
  },

  async activeCustomerCount(businessId) {
    const r = await one(
      `SELECT COUNT(*)::int AS c
       FROM customers
       WHERE business_id=$1 AND deleted_at IS NULL
       AND (
         (last_visit_at IS NOT NULL AND last_visit_at >= now() - interval '90 days')
         OR
         (last_visit_at IS NULL AND created_at >= now() - interval '90 days')
       )`,
      [businessId]
    );
    return r?.c ?? 0;
  },

  async listAllIds() {
    const r = await one(`SELECT ARRAY_AGG(id) AS ids FROM businesses`, []);
    return r?.ids ?? [];
  },

  async updateProgram(businessId, { program_type, program_json }) {
    const storedProgram = encryptProgramSecrets(program_json);
    await exec(`UPDATE businesses SET program_type=$2, program_json=$3 WHERE id=$1`, [businessId, program_type, storedProgram]);
    return this.getById(businessId);
  },

  async updatePlan(businessId, plan) {
    await exec(`UPDATE businesses SET plan=$2 WHERE id=$1`, [businessId, plan]);
    return this.getById(businessId);
  },

  async rotateExternalAwardApiKeysToCurrent() {
    const rows = await one(
      `SELECT COALESCE(json_agg(json_build_object('id', id, 'program_json', program_json)), '[]'::json) AS items
       FROM businesses`,
      []
    );
    const items = rows?.items ?? [];
    let rotated = 0;
    for (const row of items) {
      const current = row.program_json;
      const next = rotateProgramSecretsToCurrent(current);
      const currKey = JSON.stringify(current?.external_awards?.api_key ?? null);
      const nextKey = JSON.stringify(next?.external_awards?.api_key ?? null);
      if (currKey === nextKey) continue;
      await exec(`UPDATE businesses SET program_json=$2 WHERE id=$1`, [row.id, next]);
      rotated += 1;
    }
    return rotated;
  }
};
