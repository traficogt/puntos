#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

function arg(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function list(name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && i + 1 < args.length) values.push(args[i + 1]);
  }
  return values;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

async function main() {
  const output = arg("--output");
  assert(output, "--output is required");

  const fields = Object.fromEntries(
    list("--field").map((entry) => {
      const splitAt = entry.indexOf("=");
      assert(splitAt > 0, `Invalid --field value: ${entry}`);
      const key = entry.slice(0, splitAt);
      const rawValue = entry.slice(splitAt + 1);
      return [key, parseValue(rawValue)];
    })
  );

  const report = {
    generated_at: new Date().toISOString(),
    ...fields
  };

  // Operator tools intentionally write to the report path requested on the CLI.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.mkdir(path.dirname(output), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`REPORT wrote ${output}`);
}

main().catch((error) => {
  console.error(`REPORT FAIL: ${error.message || error}`);
  process.exit(1);
});
