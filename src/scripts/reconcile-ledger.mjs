#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config();

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function ensureDir(dirPath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(dirPath, { recursive: true });
}

function prepareSecretFileEnv() {
  const secretsDir = String(process.env.SECRETS_DIR || "").trim();
  if (!secretsDir) return;

  for (const fileVar of Object.keys(process.env).filter((name) => name.endsWith("_FILE"))) {
    const current = String(process.env[fileVar] || "").trim();
    if (!current.startsWith("/app/.secrets/")) continue;
    const candidate = path.join(secretsDir, path.basename(current));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(candidate)) {
      process.env[fileVar] = candidate;
    }
  }
}

async function main() {
  prepareSecretFileEnv();
  const { closeDatabase, withDbClientContext } = await import("../app/database.js");
  const { runLedgerReconciliation } = await import("../app/services/ledger-reconciliation-service.js");

  const businessId = arg("--business-id", "") || null;
  const customerId = arg("--customer-id", "") || null;
  const limit = Number(arg("--limit", process.env.LEDGER_RECONCILE_LIMIT || "5000"));
  const repair = hasFlag("--repair");
  const persist = !hasFlag("--no-persist");

  try {
    const summary = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => (
      runLedgerReconciliation({
        businessId,
        customerId,
        limit,
        repair,
        persist
      })
    ));

    const outputDir = path.join(process.cwd(), "artifacts", "ledger-reconciliation");
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, `ledger_reconcile_${new Date().toISOString().replaceAll(":", "-")}.json`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    console.log(`Ledger reconciliation complete: checked=${summary.checkedCustomers} mismatched=${summary.mismatchedCustomers} repaired=${summary.repairedCustomers}`);
    console.log(`Ledger reconciliation artifact: ${path.relative(process.cwd(), outputPath)}`);
  } finally {
    await closeDatabase().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`Ledger reconciliation: FAIL: ${error?.message || error}`);
  process.exit(1);
});
