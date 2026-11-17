import { transactionPool } from "./pools.js";
import { getDbContext, runWithDbContext } from "./context.js";
import { logger } from "../../utils/logger.js";

/**
 * Schedule work that must observe this transaction's committed rows, such as
 * follow-up writes that lock rows the transaction changed. The callback runs
 * once, after the enclosing withTransaction commits and releases its client,
 * in the caller's database context. A rollback discards it.
 * @param {() => Promise<unknown> | unknown} callback
 * @returns {boolean} false outside a withTransaction scope; the caller then owns the work.
 */
export function afterCommit(callback) {
  const callbacks = getDbContext()?.afterCommit;
  if (!Array.isArray(callbacks)) return false;
  callbacks.push(callback);
  return true;
}

export async function withTransaction(fn) {
  const parent = getDbContext() ?? {};
  const tenantId = parent.tenantId ?? null;
  const platformAdmin = parent.platformAdmin === true;
  const webhookIngest = parent.webhookIngest === true;
  const committedCallbacks = [];
  const client = await transactionPool.connect();
  let connectionError;
  // A backend termination can reject the active query and then emit a socket
  // error while ROLLBACK is pending. Keep that event within this operation.
  const onConnectionError = error => { connectionError = error; };
  client.on('error', onConnectionError);

  let out;
  try {
    out = await runWithDbContext({ ...parent, client, afterCommit: committedCallbacks }, async () => {
      await client.query("BEGIN");
      if (platformAdmin) {
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      }
      if (webhookIngest) {
        await client.query("SELECT set_config('app.webhook_ingest', 'true', true)");
      }
      if (tenantId) {
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [String(tenantId)]);
      }
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (rollbackError) { connectionError ??= rollbackError; }
    throw error;
  } finally {
    if (!connectionError) {
      try {
        await client.query(
          "SELECT set_config('app.current_tenant', '', false), set_config('app.platform_admin', '', false), set_config('app.webhook_ingest', '', false)"
        );
      } catch (resetError) { connectionError = resetError; }
    }
    client.release(Boolean(connectionError));
    client.removeListener('error', onConnectionError);
  }

  // The commit already succeeded; follow-up work reports its own failures.
  for (const callback of committedCallbacks) {
    try {
      await callback();
    } catch (error) {
      logger.warn({ err: error?.message || error }, "Post-commit work did not complete");
    }
  }
  return out;
}
