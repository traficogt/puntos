import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const scanTargets = [
  ".github/workflows",
  "src/scripts",
  "docker-compose.e2e.yml",
  "docker-compose.e2e.standalone.yml",
  "deploy/e2e/api.env",
  "deploy/db/init-e2e.sh"
];

const bannedPatterns = [
  { label: "legacy CI JWT fixture", regex: /ci_jwt_secret_abcdefghijklmnopqrstuvwxyz_123456/g },
  { label: "legacy super-admin fixture password", regex: /super_password_123456/g },
  { label: "legacy CI database fixture password", regex: /ci_test_password_123456/g },
  { label: "legacy e2e runtime app password", regex: /loyalty_app_password/g },
  { label: "legacy e2e runtime admin password", regex: /loyalty_admin_password/g },
  { label: "legacy e2e overlay password", regex: /loyalty_e2e_password/g },
  { label: "legacy OpenAPI docs DB placeholder", regex: /docs_db_password_1234567890/g },
  { label: "legacy OpenAPI docs JWT placeholder", regex: /docs_jwt_secret_abcdefghijklmnopqrstuvwxyz_123456/g },
  { label: "legacy postgres script default", regex: /DB_PASSWORD\s*=\s*"postgres"/g }
];

function collectFiles(targetPath) {
  const absolutePath = path.join(ROOT, targetPath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) return [absolutePath];

  const files = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const childPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.relative(ROOT, childPath)));
      continue;
    }
    files.push(childPath);
  }
  return files;
}

describe("security guardrails", () => {
  it("does not reintroduce fixed secret literals in workflows and harnesses", () => {
    const findings = [];
    const files = scanTargets.flatMap((targetPath) => collectFiles(targetPath));

    for (const filePath of files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const source = fs.readFileSync(filePath, "utf8");
      for (const { label, regex } of bannedPatterns) {
        const matches = Array.from(source.matchAll(regex));
        for (const match of matches) {
          findings.push(`${path.relative(ROOT, filePath)}: ${label} -> ${match[0]}`);
        }
      }
    }

    assert.deepEqual(findings, []);
  });
});
