#!/usr/bin/env node
import path from "node:path";

function cliArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

async function main() {
  const {
    rebuildLedgerCertificationIndexes
  } = await import("../app/services/ledger-certification-service.js");

  const outputRoot = cliArg("--output-root", path.join(process.cwd(), "artifacts", "ledger-certifications"));
  const retentionDays = Number(cliArg("--retention-days", process.env.LEDGER_CERTIFICATION_RETENTION_DAYS || "90"));

  const result = rebuildLedgerCertificationIndexes({
    outputRoot,
    retentionDays
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    ...result
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`prune-ledger-certifications FAIL: ${error?.message || error}\n`);
  process.exit(1);
});
