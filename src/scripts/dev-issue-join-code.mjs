#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
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

function random6() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

async function main() {
  prepareSecretFileEnv();

  const slug = String(arg("--slug")).trim();
  const phone = String(arg("--phone")).trim();
  if (!slug) throw new Error("--slug is required");
  if (!phone) throw new Error("--phone is required");

  const { closeDatabase, withDbClientContext } = await import("../app/database.js");
  const { BusinessRepo } = await import("../app/repositories/business-repository.js");
  const { VerifyCodeRepo } = await import("../app/repositories/verify-code-repository.js");

  try {
    const result = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      const business = await BusinessRepo.getBySlug(slug);
      if (!business?.id) throw new Error(`Business not found for slug: ${slug}`);

      const code = random6();
      const codeHash = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await VerifyCodeRepo.create({
        id: crypto.randomUUID(),
        business_id: business.id,
        phone,
        code_hash: codeHash,
        expires_at: expiresAt
      });

      return {
        ok: true,
        business_id: business.id,
        slug,
        phone,
        code,
        expires_at: expiresAt.toISOString()
      };
    });

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await closeDatabase().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`dev-issue-join-code FAIL: ${error?.message || error}\n`);
  process.exit(1);
});
