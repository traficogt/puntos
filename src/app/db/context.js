import { AsyncLocalStorage } from "node:async_hooks";

const dbContext = new AsyncLocalStorage();

export function runWithDbContext(ctx, fn) {
  return dbContext.run(ctx, fn);
}

export function getDbContext() {
  return dbContext.getStore() ?? null;
}

export function getDbTenantId() {
  return getDbContext()?.tenantId ?? null;
}

export function setDbTenantId(tenantId) {
  const store = dbContext.getStore();
  if (!store) return;
  store.tenantId = tenantId ? String(tenantId) : null;
}

export function getDbPlatformAdmin() {
  return getDbContext()?.platformAdmin === true;
}

export function setDbPlatformAdmin(platformAdmin) {
  const store = dbContext.getStore();
  if (!store) return;
  store.platformAdmin = platformAdmin === true;
}

export function getDbWebhookIngest() {
  return getDbContext()?.webhookIngest === true;
}

export function setDbWebhookIngest(webhookIngest) {
  const store = dbContext.getStore();
  if (!store) return;
  store.webhookIngest = webhookIngest === true;
}
