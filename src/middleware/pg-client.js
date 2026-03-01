import { pool, runWithDbContext } from "../app/database.js";

/**
 * Attaches a dedicated pg client to req.pgClient for the lifetime of the request.
 * Ensures SET LOCAL app.current_tenant can be applied for RLS.
 */
export function withPgClient(req, res, next) {
  pool.connect().then((client) => {
    runWithDbContext({ client, tenantId: null, platformAdmin: false }, () => {
      req.pgClient = client;
      const releaseOnce = (() => {
        let released = false;
        return () => {
          if (released) return;
          released = true;
          // Ensure session-scoped GUCs don't leak across pooled connections.
          client
            .query("SELECT set_config('app.current_tenant', '', false), set_config('app.platform_admin', '', false), set_config('app.webhook_ingest', '', false)")
            .catch(() => {})
            .finally(() => client.release());
        };
      })();
      res.once("finish", releaseOnce);
      res.once("close", releaseOnce);
      next();
    });
  }).catch((err) => next(err));
}
