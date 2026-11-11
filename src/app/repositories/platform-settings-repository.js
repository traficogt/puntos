import { one, exec } from "./base.js";
import { withTransaction } from "../database.js";

export const PlatformSettingsRepo = {
  async getPlanFeatures() {
    // Plan capabilities are shared public configuration. Read only this key
    // using a separate transaction; never elevate the caller's request client.
    return withTransaction(async client => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const { rows } = await client.query("SELECT value FROM platform_settings WHERE key = 'plan_features'");
      return rows[0]?.value ?? {};
    });
  },
  async getJson(key, fallback = {}) {
    const row = await one(`SELECT value FROM platform_settings WHERE key = $1`, [key]);
    if (!row || row.value == null) return fallback;
    return row.value;
  },

  async setJson(key, value) {
    await exec(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
    return this.getJson(key, {});
  }
};
