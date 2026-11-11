#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";

const args = process.argv.slice(2);

function arg(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function shaPathFor(filePath) {
  return `${filePath}.sha256`;
}

function jsonPathFor(filePath) {
  return `${filePath}.json`;
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    // Operator tools intentionally work on the path passed on the CLI.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(undefined));
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function verifySqlDump(filePath) {
  // Operator paths come from the CLI and are never returned as file content.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const input = fs.createReadStream(filePath);
  const decoded = filePath.endsWith(".gz") ? input.pipe(zlib.createGunzip()) : input;
  input.on("error", (error) => decoded.destroy(error));
  const lines = readline.createInterface({ input: decoded, crlfDelay: Infinity });
  let header = false;
  let complete = false;
  let statements = false;
  for await (const line of lines) {
    if (line === "-- PostgreSQL database dump") header = true;
    if (line === "-- PostgreSQL database dump complete") complete = true;
    if (/^(?:CREATE|COPY|INSERT|ALTER|SET|SELECT)\s/.test(line)) statements = true;
  }
  assert(header && complete && statements, "Backup is empty or is not a complete PostgreSQL SQL dump");
}

async function readExpectedSha(filePath) {
  const sidecar = shaPathFor(filePath);
  if (!(await fileExists(sidecar))) return "";
  const firstLine = await new Promise((resolve, reject) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stream = fs.createReadStream(sidecar, "utf8");
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.once("line", (line) => {
      resolve(line);
      rl.close();
      stream.destroy();
    });
    rl.once("close", () => resolve(""));
    rl.once("error", reject);
  });
  return String(firstLine).trim().split(/\s+/)[0] || "";
}

async function readManifestSha(filePath) {
  const manifestPath = jsonPathFor(filePath);
  if (!(await fileExists(manifestPath))) return "";
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    return typeof manifest.sha256 === "string" ? manifest.sha256 : "";
  } catch {
    return "";
  }
}

async function main() {
  const file = arg("--file");
  assert(file, "--file is required");

  const resolved = path.resolve(file);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const stat = await fs.promises.stat(resolved);
  assert(stat.isFile(), `Not a file: ${resolved}`);

  const sha256 = await sha256File(resolved);
  const expectedSha = await readExpectedSha(resolved);
  const manifestSha = await readManifestSha(resolved);

  await verifySqlDump(resolved);

  if (hasFlag("--require-metadata")) {
    assert(expectedSha && manifestSha, "Backup checksum sidecar and manifest are required");
  }

  if (expectedSha) {
    assert(expectedSha === sha256, `SHA sidecar mismatch for ${resolved}`);
  }
  if (manifestSha) {
    assert(manifestSha === sha256, `Manifest checksum mismatch for ${resolved}`);
  }

  const result = {
    ok: true,
    file: resolved,
    bytes: stat.size,
    sha256,
    gzip_valid: resolved.endsWith(".gz"),
    sql_dump_complete: true,
    has_sha_sidecar: Boolean(expectedSha),
    has_manifest: Boolean(manifestSha)
  };

  if (hasFlag("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`BACKUP VERIFY PASS file=${resolved} bytes=${stat.size} sha256=${sha256}`);
}

main().catch((error) => {
  console.error(`BACKUP VERIFY FAIL: ${error.message || error}`);
  process.exit(1);
});
