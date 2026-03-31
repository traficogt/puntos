import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");

function collectJsFiles(dirPath) {
  const files = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const childPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(childPath));
      continue;
    }
    if (entry.name.endsWith(".js")) files.push(childPath);
  }
  return files;
}

describe("runtime style guardrails", () => {
  it("does not use direct inline style mutations in public scripts", () => {
    const findings = [];
    const files = collectJsFiles(PUBLIC_DIR);

    for (const filePath of files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const source = fs.readFileSync(filePath, "utf8");
      if (/\.style\./.test(source) || /setAttribute\(\s*["']style/.test(source)) {
        findings.push(path.relative(ROOT, filePath));
      }
    }

    assert.deepEqual(findings, []);
  });
});
