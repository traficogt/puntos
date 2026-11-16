import { pool, runWithDbContext } from "../app/database.js";

/**
 * Attaches a dedicated pg client to req.pgClient for the lifetime of the request.
 * Keeps request-scoped work on one connection until completion or disconnect.
 */
export function withPgClient(req, res, next) {
  let closedWhileConnecting = false;
  const markClosed = () => { closedWhileConnecting = true; };
  res.once("close", markClosed);
  pool.connect().then((client) => {
    res.off("close", markClosed);
    if (closedWhileConnecting || req.aborted || res.destroyed) {
      client.release(true);
      return;
    }
    runWithDbContext({ client, tenantId: null, platformAdmin: false }, () => {
      req.pgClient = client;
      let released = false;
      const releaseOnce = async (destroy) => {
        if (released) return;
        released = true;
        res.off("finish", onFinish);
        res.off("close", onClose);
        if (!destroy) {
          try {
            // A completed response may return its connection only after reset.
            await client.query("SELECT set_config('app.current_tenant', '', false), set_config('app.platform_admin', '', false), set_config('app.webhook_ingest', '', false)");
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
  }).catch((err) => {
    res.off("close", markClosed);
    next(err);
  });
}
