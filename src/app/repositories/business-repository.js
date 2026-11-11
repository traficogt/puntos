import { one, exec } from "./base.js";
import { decryptProgramSecrets, encryptProgramSecrets, rotateProgramSecretsToCurrent, sanitizeProgramForClient } from "../../utils/program-secrets.js";

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
    const business = await one(
      `SELECT business_id AS id, slug, name, category, program_type, program_json, customer_branding_json
       FROM business_public
       WHERE slug=$1`,
      [slug]
    );
    return business ? { ...business, program_json: sanitizeProgramForClient(business.program_json) } : null;
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
         (last_visit_at IS NULL AND imported_at IS NULL AND created_at >= now() - interval '90 days')
       )`,
      [businessId]
    );
    return r?.c ?? 0;
  },

  async listAllIds() {
    const r = await one(`SELECT ARRAY_AGG(id) AS ids FROM businesses`, []);
    return r?.ids ?? [];
  },

  async updateProgram(businessId, { program_type, program_json, preserveIntegrations = true }) {
    const submittedProgram = { ...(program_json ?? {}) };
    // POS state belongs to the connection service, never to ordinary program saves.
    delete submittedProgram.pos_integration;
    if (preserveIntegrations) {
      delete submittedProgram.external_awards;
    }
    const storedProgram = encryptProgramSecrets(submittedProgram);
    const lifecycle = submittedProgram.lifecycle;
    const missingManagedLifecycleKeys = [
      "birthday_monthly_points_cap", "winback_monthly_points_cap", "minimum_contact_days"
    ].filter(key => !lifecycle || typeof lifecycle !== "object" || !Object.hasOwn(lifecycle, key));
    // Merge the current row, not an earlier read: polling and key rotation can
    // change integration state while the owner is editing ordinary program rules.
    const externalAwardsSql = preserveIntegrations
      ? `|| CASE WHEN program_json ? 'external_awards'
           THEN jsonb_build_object('external_awards', program_json->'external_awards') ELSE '{}'::jsonb END`
      : "";
    const sql = `UPDATE businesses SET program_type=$2, program_json=$3::jsonb
       || CASE WHEN program_json ? 'pos_integration'
            THEN jsonb_build_object('pos_integration', program_json->'pos_integration') ELSE '{}'::jsonb END
       ${externalAwardsSql}
       || CASE WHEN NOT ($3::jsonb ? 'lifecycle') AND program_json ? 'lifecycle'
          THEN jsonb_build_object('lifecycle', program_json->'lifecycle')
          WHEN jsonb_typeof(program_json->'lifecycle')='object'
                     AND (program_json->'lifecycle') ?| $4::text[]
          THEN jsonb_build_object('lifecycle',
            (SELECT jsonb_object_agg(key,value) FROM jsonb_each(program_json->'lifecycle')
             WHERE key=ANY($4::text[]))
            || CASE WHEN jsonb_typeof($3::jsonb->'lifecycle')='object'
                    THEN $3::jsonb->'lifecycle' ELSE '{}'::jsonb END)
          ELSE '{}'::jsonb END
       WHERE id=$1`;
    // Older forms do not submit the guided controls. Preserve only omitted
    // controls from the row that UPDATE locks, including a null lifecycle input.
    // An entirely omitted lifecycle (also stripped for basic-only permissions)
    // leaves that separate feature intact instead of implicitly disabling it.
    // This stays on the caller's client/transaction; no nested lock is acquired.
    await exec(sql, [businessId, program_type, storedProgram, missingManagedLifecycleKeys]);
    return this.getById(businessId);
  },

  async updateLifecycle(businessId, patch) {
    // Templates change only their declared lifecycle fields. A previous full
    // program read must not replace concurrent guided controls or other rules.
    return normalizeBusinessRecord(await one(
      `UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,'{}'::jsonb), '{lifecycle}',
         (CASE WHEN jsonb_typeof(program_json->'lifecycle')='object'
            THEN program_json->'lifecycle' ELSE '{}'::jsonb END) || $2::jsonb), updated_at=now()
       WHERE id=$1 RETURNING *`,
      [businessId, patch]
    ));
  },

  async updateCampaignRules(businessId, rules) {
    return normalizeBusinessRecord(await one(
      `UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,'{}'::jsonb), '{campaign_rules}', $2::jsonb), updated_at=now()
       WHERE id=$1 RETURNING *`,
      [businessId, JSON.stringify(rules)]
    ));
  },

  async updateExternalAwards(businessId, patch) {
    const stored = encryptProgramSecrets({ external_awards: patch }).external_awards;
    await exec(
      `UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,'{}'::jsonb), '{external_awards}',
         (CASE WHEN jsonb_typeof(program_json->'external_awards')='object'
            THEN program_json->'external_awards' ELSE '{}'::jsonb END) || $2::jsonb), updated_at=now()
       WHERE id=$1`,
      [businessId, stored]
    );
    return this.getById(businessId);
  },

  async updatePlan(businessId, plan) {
    await exec(`UPDATE businesses SET plan=$2 WHERE id=$1`, [businessId, plan]);
    return this.getById(businessId);
  },

  async updateCustomerBranding(businessId, branding) {
    await exec(
      `UPDATE businesses
       SET customer_branding_json=$2, updated_at=now()
       WHERE id=$1`,
      [businessId, branding]
    );
    return this.getById(businessId);
  },

  async getCustomerBrandingById(businessId) {
    const row = await one(
      `SELECT customer_branding_json
       FROM businesses
       WHERE id=$1`,
      [businessId]
    );
    return row?.customer_branding_json ?? null;
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
      const currKey = JSON.stringify([current?.external_awards?.api_key ?? null, current?.pos_integration?.loyverse?.access_token ?? null]);
      const nextKey = JSON.stringify([next?.external_awards?.api_key ?? null, next?.pos_integration?.loyverse?.access_token ?? null]);
      if (currKey === nextKey) continue;
      await exec(`UPDATE businesses SET program_json=$2 WHERE id=$1 AND program_json=$3::jsonb`, [row.id, next, current]);
      rotated += 1;
    }
    return rotated;
  }
};
