#!/usr/bin/env node
/**
 * One-time operator step after 2026-11-17-analytics-purchase-stats.sql.
 * Recomputes derived customer_ltv purchase statistics (spend, visits, purchase
 * count, average, first/last purchase, frequency, predicted value and churn
 * risk) with the canonical recorded-purchase definition. Transactions, point
 * balances and visit streaks are never modified. Each business runs under its
 * own tenant RLS context in short transactions of --batch-size customers, so
 * the job may run while the application is serving traffic and may be repeated.
 *
 *   npm run ops:analytics:recompute-purchase-stats -- [--business-id <uuid>] [--batch-size 200]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

function cliArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function prepareSecretFileEnv() {
  const secretsDir = String(process.env.SECRETS_DIR || "").trim();
  if (!secretsDir) return;
  for (const fileVar of Object.keys(process.env).filter((name) => name.endsWith("_FILE"))) {
    const current = String(process.env[fileVar] || "").trim();
    if (!current.startsWith("/app/.secrets/")) continue;
    const candidate = path.join(secretsDir, path.basename(current));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(candidate)) process.env[fileVar] = candidate;
  }
}

/**
 * @param {string} businessId
 * @param {{ batchSize?: number }} [options]
 */
export async function recomputeBusinessPurchaseStats(businessId, { batchSize = 200 } = {}) {
  const { dbQuery, withDbClientContext, withTransaction } = await import("../app/database.js");
  const { refreshCustomerLtv } = await import("../app/services/customer-derived-state.js");
  const size = Math.max(1, Math.min(1000, Math.floor(Number(batchSize) || 0) || 200));

  return withDbClientContext({ platformAdmin: false, tenantId: businessId }, async () => {
    let after = null;
    let customers = 0;
    for (;;) {
      const { rows } = await dbQuery(
        `SELECT cl.customer_id
         FROM customer_ltv cl
         JOIN customers c ON c.id = cl.customer_id
         WHERE c.business_id = $1
           AND ($2::uuid IS NULL OR cl.customer_id > $2::uuid)
         ORDER BY cl.customer_id
         LIMIT $3`,
        [businessId, after, size]
      );
      if (!rows.length) break;
      await withTransaction(async (client) => {
        for (const row of rows) await refreshCustomerLtv(client, row.customer_id);
      });
      customers += rows.length;
      after = rows[rows.length - 1].customer_id;
    }
    return { businessId, customers };
  });
}

async function main() {
  dotenv.config({ quiet: true });
  prepareSecretFileEnv();
  const { closeDatabase, withDbClientContext } = await import("../app/database.js");
  const { BusinessRepo } = await import("../app/repositories/business-repository.js");
  const businessId = cliArg("--business-id", "");
  const batchSize = Number(cliArg("--batch-size", "200"));

  try {
    // Platform authority only lists businesses; recomputation is per tenant.
    const businessIds = businessId
      ? [businessId]
      : await withDbClientContext({ platformAdmin: true, tenantId: null }, () => BusinessRepo.listAllIds());
    const results = [];
    for (const bid of businessIds) results.push(await recomputeBusinessPurchaseStats(bid, { batchSize }));
    process.stdout.write(`${JSON.stringify({
      ok: true,
      businesses: results.length,
      customers: results.reduce((total, result) => total + result.customers, 0)
    })}\n`);
  } finally {
    await closeDatabase().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`recompute-customer-purchase-stats FAIL: ${error?.message || error}\n`);
    process.exit(1);
  });
}
