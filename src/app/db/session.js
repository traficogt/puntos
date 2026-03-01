import { pool } from "./pools.js";
import {
  getDbContext,
  getDbPlatformAdmin,
  getDbTenantId,
  getDbWebhookIngest,
  runWithDbContext,
  setDbPlatformAdmin,
  setDbTenantId,
  setDbWebhookIngest
} from "./context.js";

export function getDbClient() {
  return getDbContext()?.client ?? pool;
}

export async function dbQuery(sql, params = []) {
  return getDbClient().query(sql, params);
}

export async function setCurrentTenant(tenantId, opts = {}) {
  const value = tenantId ? String(tenantId) : "";
  setDbTenantId(tenantId);
  const store = getDbContext();
  if (!store?.client) return;
  await store.client.query("SELECT set_config('app.current_tenant', $1, $2)", [value, opts.local === true]);
}

export async function setPlatformAdmin(platformAdmin, opts = {}) {
  const value = platformAdmin ? "true" : "";
  setDbPlatformAdmin(platformAdmin);
  const store = getDbContext();
  if (!store?.client) return;
  await store.client.query("SELECT set_config('app.platform_admin', $1, $2)", [value, opts.local === true]);
}

export async function setWebhookIngest(webhookIngest, opts = {}) {
  const value = webhookIngest ? "true" : "";
  setDbWebhookIngest(webhookIngest);
  const store = getDbContext();
  if (!store?.client) return;
  await store.client.query("SELECT set_config('app.webhook_ingest', $1, $2)", [value, opts.local === true]);
}

export async function withDbClientContext(ctx, fn) {
  const parent = getDbContext();
  const hasClient = Boolean(parent?.client);
  const prevTenantId = getDbTenantId();
  const prevPlatform = getDbPlatformAdmin();
  const prevIngest = getDbWebhookIngest();

  const run = async (client) => {
    const tenantId = Object.prototype.hasOwnProperty.call(ctx, "tenantId") ? (ctx.tenantId ?? null) : prevTenantId;
    const platformAdmin = Object.prototype.hasOwnProperty.call(ctx, "platformAdmin") ? (ctx.platformAdmin === true) : prevPlatform;
    const webhookIngest = Object.prototype.hasOwnProperty.call(ctx, "webhookIngest") ? (ctx.webhookIngest === true) : prevIngest;

    return runWithDbContext(
      { ...(parent ?? {}), client, tenantId, platformAdmin, webhookIngest },
      async () => {
        await setPlatformAdmin(platformAdmin);
        await setWebhookIngest(webhookIngest);
        await setCurrentTenant(tenantId);
        return fn(client);
      }
    );
  };

  if (hasClient) {
    try {
      return await run(parent.client);
    } finally {
      await setPlatformAdmin(prevPlatform).catch(() => {});
      await setWebhookIngest(prevIngest).catch(() => {});
      await setCurrentTenant(prevTenantId).catch(() => {});
    }
  }

  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    try {
      await client.query(
        "SELECT set_config('app.current_tenant', '', false), set_config('app.platform_admin', '', false), set_config('app.webhook_ingest', '', false)"
      );
    } catch {}
    client.release();
  }
}
