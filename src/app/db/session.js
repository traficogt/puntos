import { pool } from "./pools.js";
import {
  getDbContext,
  getDbPlatformAdmin,
  getDbTenantId,
  getDbWebhookIngest,
  runWithDbContext,
  setDbPlatformAdmin,
  setDbTenantId,
  setDbWebhookIngest,
} from "./context.js";

/** @typedef {import("../../types/db.js").DbClient} DbClient */
/** @typedef {import("../../types/db.js").DbContextOverrides} DbContextOverrides */

/**
 * Options for the session-setting helpers. `local` scopes the setting to the
 * current transaction (`set_config(..., true)`) instead of the session.
 * @typedef {{ local?: boolean }} SetConfigOptions
 */

/**
 * The pinned connection of the current context, or the shared pool. Both are
 * real pg connections at runtime; the loose context type exists only so tests
 * can pin doubles (see src/types/db.ts).
 * @returns {DbClient}
 */
export function getDbClient() {
  return /** @type {DbClient} */ (getDbContext()?.client ?? pool);
}

/**
 * Runs a query on the context's connection or the pool.
 *
 * The result is deliberately untyped (`any`): repositories and services accept
 * `typeof dbQuery` as an injectable dependency, tests pass doubles that answer
 * `{ rows }` only, and even `rows: any[]` types `rows.map(...)` results, which
 * today exposes a readiness-shape reassignment in platform-health-service.js
 * (tests/unit/historical-region-health.test.js:103). Declare it
 * `Promise<import("../../types/db.js").DbQueryResultLike>` once that is fixed.
 * @param {string} sql
 * @param {import("pg").QueryValues} [params]
 * @returns {Promise<any>}
 */
export async function dbQuery(sql, params = []) {
  return getDbClient().query(sql, params);
}

/**
 * @param {string | null | undefined} tenantId
 * @param {SetConfigOptions} [opts]
 */
export async function setCurrentTenant(tenantId, opts = {}) {
  const value = tenantId ? String(tenantId) : "";
  setDbTenantId(tenantId);
  const store = getDbContext();
  if (!store?.client) return;
  await store.client.query("SELECT set_config('app.current_tenant', $1, $2)", [
    value,
    opts.local === true,
  ]);
}

/**
 * @param {boolean | null | undefined} platformAdmin
 * @param {SetConfigOptions} [opts]
 */
export async function setPlatformAdmin(platformAdmin, opts = {}) {
  const value = platformAdmin ? "true" : "";
  setDbPlatformAdmin(platformAdmin);
  const store = getDbContext();
  if (!store?.client) return;
  await store.client.query("SELECT set_config('app.platform_admin', $1, $2)", [
    value,
    opts.local === true,
  ]);
}

/**
 * @param {boolean | null | undefined} webhookIngest
 * @param {SetConfigOptions} [opts]
 */
export async function setWebhookIngest(webhookIngest, opts = {}) {
  const value = webhookIngest ? "true" : "";
  setDbWebhookIngest(webhookIngest);
  const store = getDbContext();
  if (!store?.client) return;
  await store.client.query("SELECT set_config('app.webhook_ingest', $1, $2)", [
    value,
    opts.local === true,
  ]);
}

/**
 * Runs `fn` with the given tenant / privilege flags applied to one connection:
 * the context's pinned connection when there is one, otherwise a pool
 * connection that is reset and released afterwards.
 *
 * The callback's connection is deliberately untyped (`any`): this function is
 * the default of injectable `context` dependencies whose test doubles call
 * `fn()` without a connection, while service callbacks read `client.query`
 * unguarded. Type it as `DbClient` once the doubles pass the connection through.
 * @template T
 * @param {DbContextOverrides} ctx
 * @param {(client?: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withDbClientContext(ctx, fn) {
  const parent = getDbContext();
  const prevTenantId = getDbTenantId();
  const prevPlatform = getDbPlatformAdmin();
  const prevIngest = getDbWebhookIngest();

  /** @param {import("../../types/db.js").DbClientLike} client */
  const run = async (client) => {
    const tenantId = Object.prototype.hasOwnProperty.call(ctx, "tenantId")
      ? (ctx.tenantId ?? null)
      : prevTenantId;
    const platformAdmin = Object.prototype.hasOwnProperty.call(ctx, "platformAdmin")
      ? ctx.platformAdmin === true
      : prevPlatform;
    const webhookIngest = Object.prototype.hasOwnProperty.call(ctx, "webhookIngest")
      ? ctx.webhookIngest === true
      : prevIngest;

    return runWithDbContext(
      { ...(parent ?? {}), client, tenantId, platformAdmin, webhookIngest },
      async () => {
        await setPlatformAdmin(platformAdmin);
        await setWebhookIngest(webhookIngest);
        await setCurrentTenant(tenantId);
        return fn(/** @type {DbClient} */ (client));
      },
    );
  };

  if (parent?.client) {
    try {
      return await run(parent.client);
    } finally {
      await setPlatformAdmin(prevPlatform).catch(() => {});
      await setWebhookIngest(prevIngest).catch(() => {});
      await setCurrentTenant(prevTenantId).catch(() => {});
    }
  }

  const client = await pool.connect();
  let destroy = false;
  try {
    return await run(client);
  } finally {
    try {
      await client.query(
        "SELECT set_config('app.current_tenant', '', false), set_config('app.platform_admin', '', false), set_config('app.webhook_ingest', '', false)",
      );
    } catch {
      // Session settings could not be cleared (typically a dead connection):
      // discard the client rather than hand its context to another caller.
      destroy = true;
    }
    client.release(destroy);
  }
}
