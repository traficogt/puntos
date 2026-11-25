import { withDbClientContext, withTransaction } from "../database.js";
/**
 * @typedef {import("../../types/db.js").DbQueryClient} SupportMaintenanceQueryClient
 * @typedef {<T>(fn: (client: SupportMaintenanceQueryClient) => Promise<T>) => Promise<T>} SupportMaintenanceTransaction
 */
// Run from the daily worker. DELETE policy permits only expired attachments.
/** @param {{ transaction?: SupportMaintenanceTransaction }} [deps] */
export async function purgeExpiredSupportAttachments(deps = {}) {
  const work = () =>
    /** @type {SupportMaintenanceTransaction} */ (deps.transaction || withTransaction)(
      async (c) => {
        const result = await c.query(
          "DELETE FROM support_case_attachments WHERE id IN (SELECT id FROM support_case_attachments WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 500)",
        );
        return { deleted: result.rowCount };
      },
    );
  return deps.transaction
    ? work()
    : withDbClientContext({ platformAdmin: true, tenantId: null }, work);
}
