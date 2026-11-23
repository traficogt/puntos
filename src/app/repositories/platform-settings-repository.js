import { one, exec } from "./base.js";
import { withTransaction } from "../database.js";

export const PlatformSettingsRepo = {
  async getPlanFeatures() {
    // Plan capabilities are shared public configuration. Read only this key
    // using a separate transaction; never elevate the caller's request client.
    return withTransaction(async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const { rows } = await client.query(
        "SELECT value FROM platform_settings WHERE key = 'plan_features'",
      );
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
      [key, value],
    );
    return this.getJson(key, {});
  },

  // Per-business wallet-broadcast opt-in + caps + channel policy. Platform-owned
  // (superadmin-only writes); read here in a self-contained platform-admin transaction
  // so the per-tenant dispatch can load it without elevating its own request context.
  async getWalletBroadcast() {
    return withTransaction(async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const { rows } = await client.query(
        "SELECT value FROM platform_settings WHERE key = 'wallet_broadcast_settings'",
      );
      return rows[0]?.value ?? {};
    });
  },

  // Owner progress ("Tu progreso") mode and holdout share. Platform-owned; read in a
  // self-contained platform-admin transaction so owner requests can load it without
  // elevating their own tenant context (platform_settings is platform-admin only).
  async getOwnerProgress() {
    return withTransaction(async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const { rows } = await client.query(
        "SELECT value FROM platform_settings WHERE key = 'owner_progress'",
      );
      return rows[0]?.value ?? {};
    });
  },

  async setOwnerProgress(value) {
    return withTransaction(async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const { rows } = await client.query(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ('owner_progress', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         RETURNING value`,
        [value],
      );
      return rows[0]?.value ?? value;
    });
  },

  async setWalletBroadcastForBusiness(businessId, patch) {
    return withTransaction(async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const { rows } = await client.query(
        "SELECT value FROM platform_settings WHERE key = 'wallet_broadcast_settings' FOR UPDATE",
      );
      const current = rows[0]?.value ?? {};
      const next = { ...current, [businessId]: { ...(current[businessId] || {}), ...patch } };
      await client.query(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ('wallet_broadcast_settings', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [next],
      );
      return next[businessId];
    });
  },
};
