import { transactionPool } from "./pools.js";
import { getDbContext, runWithDbContext } from "./context.js";

/** @typedef {import("../../types/db.js").DbTransactionClient} DbTransactionClient */

/**
 * Runs `fn` inside BEGIN/COMMIT on a dedicated transaction-pool connection that
 * carries the current context's tenant and privilege flags as transaction-local
 * settings. Any failure rolls back and rethrows.
 *
 * The callback's connection and the result are deliberately untyped (`any`):
 * this function is the default of injectable `transaction` dependencies whose
 * test doubles call `fn()` without a connection, services return its query
 * results from hooks that must resolve to void (operating-template-service.js:322),
 * and a unit test reads fields only its double returns. Type the parameter as
 * `import("../../types/db.js").DbClient` once those callers adapt.
 * @param {(client?: any) => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function withTransaction(fn) {
  const parent = getDbContext() ?? {};
  const tenantId = parent.tenantId ?? null;
  const platformAdmin = parent.platformAdmin === true;
  const webhookIngest = parent.webhookIngest === true;
  // The pool hands out real pg connections (EventEmitters); the loose pool
  // contract exists only so tests can pin doubles (see src/types/db.ts).
  const client = /** @type {DbTransactionClient} */ (await transactionPool.connect());
  /** @type {unknown} */
  let connectionError;
  // A backend termination can reject the active query and then emit a socket
  // error while ROLLBACK is pending. Keep that event within this operation.
  /** @param {Error} error */
  const onConnectionError = (error) => {
    connectionError = error;
  };
  client.on("error", onConnectionError);

  try {
    return await runWithDbContext({ ...parent, client }, async () => {
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
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      connectionError ??= rollbackError;
    }
    throw error;
  } finally {
    if (!connectionError) {
      try {
        await client.query(
          "SELECT set_config('app.current_tenant', '', false), set_config('app.platform_admin', '', false), set_config('app.webhook_ingest', '', false)",
        );
      } catch (resetError) {
        connectionError = resetError;
      }
    }
    client.release(Boolean(connectionError));
    client.removeListener("error", onConnectionError);
  }
}
