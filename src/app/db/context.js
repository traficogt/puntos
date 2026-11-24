import { AsyncLocalStorage } from "node:async_hooks";

/** @typedef {import("../../types/db.js").DbContext} DbContext */

/** @type {AsyncLocalStorage<DbContext>} */
const dbContext = new AsyncLocalStorage();

/**
 * @template T
 * @param {DbContext} ctx
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithDbContext(ctx, fn) {
  return dbContext.run(ctx, fn);
}

/** @returns {DbContext | null} */
export function getDbContext() {
  return dbContext.getStore() ?? null;
}

export function getDbTenantId() {
  return getDbContext()?.tenantId ?? null;
}

/** @param {string | null | undefined} tenantId */
export function setDbTenantId(tenantId) {
  const store = dbContext.getStore();
  if (!store) return;
  store.tenantId = tenantId ? String(tenantId) : null;
}

export function getDbPlatformAdmin() {
  return getDbContext()?.platformAdmin === true;
}

/** @param {boolean | null | undefined} platformAdmin */
export function setDbPlatformAdmin(platformAdmin) {
  const store = dbContext.getStore();
  if (!store) return;
  store.platformAdmin = platformAdmin === true;
}

export function getDbWebhookIngest() {
  return getDbContext()?.webhookIngest === true;
}

/** @param {boolean | null | undefined} webhookIngest */
export function setDbWebhookIngest(webhookIngest) {
  const store = dbContext.getStore();
  if (!store) return;
  store.webhookIngest = webhookIngest === true;
}
