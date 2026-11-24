import { pool, runWithDbContext } from "../app/database.js";

/** @typedef {import("express").NextFunction} NextFunction */

// Only API traffic reads the request-pinned connection (tenant and admin GUCs
// travel with it). Static assets, HTML entry pages and marketing routes never
// use it; the marketing plan page reads through its own transaction pool.
export const PG_CLIENT_MOUNT_PATHS = ["/api"];

/**
 * Mounts withPgClient on the API prefixes only, so a CSS, JS, font or image
 * request never holds one of the pool's connections.
 * @param {import("express").Express} app
 */
export function mountPgClient(app) {
  for (const mountPath of PG_CLIENT_MOUNT_PATHS) app.use(mountPath, withPgClient);
}

/**
 * The request and response surface this middleware uses; tests drive it with
 * plain objects, so the contract is structural rather than Express's types.
 * @typedef {{ aborted?: boolean, pgClient?: import("../types/db.js").DbPooledClient }} PgClientRequest
 * @typedef {{
 *   once(event: "close" | "finish", listener: () => void): unknown,
 *   off(event: "close" | "finish", listener: () => void): unknown,
 *   destroyed?: boolean,
 *   writableFinished?: boolean,
 * }} PgClientResponse
 */

/**
 * Attaches a dedicated pg client to req.pgClient for the lifetime of the request.
 * Keeps request-scoped work on one connection until completion or disconnect.
 * @param {PgClientRequest} req
 * @param {PgClientResponse} res
 * @param {NextFunction} next
 */
export function withPgClient(req, res, next) {
  let closedWhileConnecting = false;
  const markClosed = () => {
    closedWhileConnecting = true;
  };
  res.once("close", markClosed);
  pool
    .connect()
    .then((client) => {
      res.off("close", markClosed);
      if (closedWhileConnecting || req.aborted || res.destroyed) {
        client.release(true);
        return;
      }
      runWithDbContext({ client, tenantId: null, platformAdmin: false }, () => {
        // The pool hands out real pg connections; the loose pool contract only
        // exists for test doubles (see src/types/db.ts).
        req.pgClient = /** @type {import("../types/db.js").DbPooledClient} */ (client);
        let released = false;
        /** @param {boolean} destroy */
        const releaseOnce = async (destroy) => {
          if (released) return;
          released = true;
          res.off("finish", onFinish);
          res.off("close", onClose);
          if (!destroy) {
            try {
              // A completed response may return its connection only after reset.
              await client.query(
                "SELECT set_config('app.current_tenant', '', false), set_config('app.platform_admin', '', false), set_config('app.webhook_ingest', '', false)",
              );
            } catch {
              destroy = true;
            }
          }
          // On premature close the handler may still be querying. Destroy rather
          // than reset its context and make the connection available to another request.
          client.release(destroy);
        };
        const onFinish = () => releaseOnce(false);
        const onClose = () => releaseOnce(!res.writableFinished);
        res.once("finish", onFinish);
        res.once("close", onClose);
        next();
      });
    })
    .catch((err) => {
      res.off("close", markClosed);
      next(err);
    });
}
