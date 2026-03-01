import { pool } from "./pools.js";
import { getDbContext, runWithDbContext } from "./context.js";

export async function withTransaction(fn) {
  const parent = getDbContext() ?? {};
  const tenantId = parent.tenantId ?? null;
  const platformAdmin = parent.platformAdmin === true;
  const webhookIngest = parent.webhookIngest === true;
  const client = await pool.connect();

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
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    try {
      await client.query(
        "SELECT set_config('app.current_tenant', '', false), set_config('app.platform_admin', '', false), set_config('app.webhook_ingest', '', false)"
      );
    } catch {}
    client.release();
  }
}
