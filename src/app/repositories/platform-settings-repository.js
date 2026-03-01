import { one, exec } from "./base.js";

export const PlatformSettingsRepo = {
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
