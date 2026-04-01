import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");

function collectHtmlFiles(dirPath) {
  const files = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const childPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectHtmlFiles(childPath));
      continue;
    }
    if (entry.name.endsWith(".html")) files.push(childPath);
  }
  return files;
}

describe("template CSP guardrails", () => {
  it("does not use inline style attributes in static HTML", () => {
    const findings = [];
    const files = collectHtmlFiles(PUBLIC_DIR);

    for (const filePath of files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const source = fs.readFileSync(filePath, "utf8");
      if (/\sstyle\s*=\s*["']/.test(source)) {
        findings.push(path.relative(ROOT, filePath));
      }
    }

    assert.deepEqual(findings, []);
  });
});
