#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

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

async function main() {
  prepareSecretFileEnv();
  const { withDbClientContext, closeDatabase } = await import("../app/database.js");
  const { BusinessRepo } = await import("../app/repositories/business-repository.js");
  const {
    resolveCertificationPeriod,
    writeLedgerCertificationArtifacts
  } = await import("../app/services/ledger-certification-service.js");

  const businessId = cliArg("--business-id", "");
  const outputRoot = cliArg("--output-root", path.join(process.cwd(), "artifacts", "ledger-certifications"));
  const retentionDays = Number(cliArg("--retention-days", process.env.LEDGER_CERTIFICATION_RETENTION_DAYS || "90"));
  const period = resolveCertificationPeriod({
    from: cliArg("--from", ""),
    to: cliArg("--to", "")
  });

  try {
    const results = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      let businessIds = [];
      if (businessId) {
        businessIds = [businessId];
      } else {
        businessIds = await BusinessRepo.listAllIds();
      }
      const out = [];
      for (const bid of businessIds) {
        out.push(await writeLedgerCertificationArtifacts({
          businessId: bid,
          from: period.from,
          to: period.to,
          outputRoot,
          retentionDays
        }));
      }
      return out;
    });

    process.stdout.write(`${JSON.stringify({
      ok: true,
      period,
      retentionDays,
      count: results.length,
      artifacts: results
    }, null, 2)}\n`);
  } finally {
    await closeDatabase().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`generate-ledger-certification FAIL: ${error?.message || error}\n`);
  process.exit(1);
});
