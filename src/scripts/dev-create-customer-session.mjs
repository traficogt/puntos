#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

function arg(name, fallback = "") {
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
    if (fs.existsSync(candidate)) {
      process.env[fileVar] = candidate;
    }
  }
}

async function main() {
  prepareSecretFileEnv();

  const slug = String(arg("--slug")).trim();
  const phone = String(arg("--phone")).trim();
  const name = String(arg("--name", "Integration Customer")).trim();
  if (!slug) throw new Error("--slug is required");
  if (!phone) throw new Error("--phone is required");

  const { closeDatabase, withDbClientContext } = await import("../app/database.js");
  const { BusinessRepo } = await import("../app/repositories/business-repository.js");
  const { CustomerRepo } = await import("../app/repositories/customer-repository.js");
  const { signCustomerToken } = await import("../utils/auth-token.js");

  try {
    const result = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      const business = await BusinessRepo.getBySlug(slug);
      if (!business?.id) throw new Error(`Business not found for slug: ${slug}`);

      const customer = await CustomerRepo.upsertByPhone({
        id: crypto.randomUUID(),
        business_id: business.id,
        phone,
        name
      });
      const token = await signCustomerToken({ cid: customer.id, bid: business.id, slug: business.slug });

      return {
        ok: true,
        business_id: business.id,
        slug: business.slug,
        customer_id: customer.id,
        phone,
        token
      };
    });

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await closeDatabase().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`dev-create-customer-session FAIL: ${error?.message || error}\n`);
  process.exit(1);
});
