import { one, exec } from "./base.js";
import { withTransaction } from "../database.js";

/** @typedef {import("./base.js").DbClient} DbClient */

/**
 * Row of `platform_settings`: one jsonb document per key. The document shape
 * belongs to the service that owns the key, so `value` is `unknown` here.
 * @typedef {{ key: string, value: unknown, updated_at: Date }} PlatformSettingRow
 */

export const PlatformSettingsRepo = {
  async getPlanFeatures() {
    // Plan capabilities are shared public configuration. Read only this key
    // using a separate transaction; never elevate the caller's request client.
    return withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
        const { rows } = await client.query(
          "SELECT value FROM platform_settings WHERE key = 'plan_features'",
        );
        return rows[0]?.value ?? {};
      },
    );
  },
  /**
   * @param {string} key
   * @param {Record<string, unknown>} [fallback]
   */
  async getJson(key, fallback = {}) {
    const row = await one(`SELECT value FROM platform_settings WHERE key = $1`, [key]);
    if (!row || row.value == null) return fallback;
    return row.value;
  },

  /**
   * @param {string} key
   * @param {unknown} value stored as jsonb
   */
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
    return withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
        const { rows } = await client.query(
          "SELECT value FROM platform_settings WHERE key = 'wallet_broadcast_settings'",
        );
        return rows[0]?.value ?? {};
      },
    );
  },

  // Owner progress ("Tu progreso") mode and holdout share. Platform-owned; read in a
  // self-contained platform-admin transaction so owner requests can load it without
  // elevating their own tenant context (platform_settings is platform-admin only).
  async getOwnerProgress() {
    return withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
        const { rows } = await client.query(
          "SELECT value FROM platform_settings WHERE key = 'owner_progress'",
        );
        return rows[0]?.value ?? {};
      },
    );
  },

  /** @param {Record<string, unknown>} value */
  async setOwnerProgress(value) {
    return withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
        const { rows } = await client.query(
          `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ('owner_progress', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         RETURNING value`,
          [value],
        );
        return rows[0]?.value ?? value;
      },
    );
  },

  // Published prices and provider price ids (docs/product/2026-11-25-self-serve-trial.md,
  // section 3.4). Platform-owned; read in a self-contained platform-admin transaction so
  // the public /precios page and owner requests never elevate their own context.
  async getBillingCatalog() {
    return withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
        const { rows } = await client.query(
          "SELECT value FROM platform_settings WHERE key = 'billing_catalog'",
        );
        return rows[0]?.value ?? {};
      },
    );
  },

  /** @param {Record<string, unknown>} value */
  async setBillingCatalog(value) {
    return withTransaction(
      /** @param {DbClient} client */
      async (client) => {
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
        const { rows } = await client.query(
          `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ('billing_catalog', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         RETURNING value`,
          [value],
        );
        return rows[0]?.value ?? value;
      },
    );
  },

  /**
   * @param {string} businessId
   * @param {Record<string, unknown>} patch merged over the business's current settings
   */
  async setWalletBroadcastForBusiness(businessId, patch) {
    return withTransaction(
      /** @param {DbClient} client */
      async (client) => {
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
      },
    );
  },
};
