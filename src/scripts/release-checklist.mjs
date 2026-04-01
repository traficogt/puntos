#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const rootDir = process.cwd();
const migrationsDir = path.join(rootDir, "src", "app", "migrations");
const lockPath = path.join(migrationsDir, "checksums.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function checkFileExists(filePath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  assert(fs.existsSync(filePath), `Missing required file: ${path.relative(rootDir, filePath)}`);
}

function checkPackageScripts() {
  const pkg = readJson(path.join(rootDir, "package.json"));
  assert(/^\d+\.\d+\.\d+/.test(String(pkg.version || "")), "package.json version must be semver-like");

  const requiredScripts = [
    "openapi:generate",
    "ops:migrate:lock-check",
    "ops:migrate:smoke",
    "ops:release:checklist",
    "ops:release:snapshot",
    "ops:release:tag-local",
    "ops:ledger:certify",
    "ops:ledger:certify:prune",
    "ops:rollback:local-image",
    "ops:rollback:verify",
    "ops:security-scan",
    "ops:smoke",
    "ops:alerts:drill"
  ];
  for (const scriptName of requiredScripts) {
    assert(pkg.scripts?.[scriptName], `Missing package.json script: ${scriptName}`);
  }
}

function checkOpenApiArtifacts() {
  const jsonPath = path.join(rootDir, "docs", "openapi.json");
  const yamlPath = path.join(rootDir, "docs", "openapi.yaml");
  checkFileExists(jsonPath);
  checkFileExists(yamlPath);
  const json = readJson(jsonPath);
  assert(typeof json.openapi === "string" && json.openapi.length > 0, "docs/openapi.json missing openapi field");
  assert(json.paths?.["/api/v1/admin/analytics/ledger-certification"], "docs/openapi.json missing /api/v1/admin/analytics/ledger-certification");
  assert(json.paths?.["/api/v1/admin/analytics/ledger-certification.csv"], "docs/openapi.json missing /api/v1/admin/analytics/ledger-certification.csv");
  assert(fs.statSync(yamlPath).size > 0, "docs/openapi.yaml is empty");
}

function checkPolicyAndRunbookDocs() {
  const requiredDocs = [
    "docs/LOYALTY_POLICY.md",
    "docs/OBSERVABILITY.md",
    "docs/INCIDENT_RUNBOOK.md",
    "docs/ROLLBACK_RUNBOOK.md",
    "docs/PRODUCTION_HARDENING_STATUS.md"
  ];
  for (const relativePath of requiredDocs) {
    checkFileExists(path.join(rootDir, relativePath));
  }
}

function checkCriticalTests() {
  const requiredTests = [
    "tests/unit/openapi-contract.test.js",
    "tests/unit/no-fixed-secrets.test.js",
    "tests/integration/refund-gamification.test.js",
    "tests/integration/recurring-gamification.test.js"
  ];
  for (const relativePath of requiredTests) {
    checkFileExists(path.join(rootDir, relativePath));
  }
}

function checkMigrationLock() {
  checkFileExists(lockPath);
  const lock = readJson(lockPath);
  const lockFiles = lock?.files && typeof lock.files === "object" ? lock.files : {};
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const current = {};
  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    current[file] = sha256(fs.readFileSync(filePath, "utf8"));
  }

  const expectedNames = Object.keys(lockFiles).sort();
  assert(JSON.stringify(expectedNames) === JSON.stringify(migrationFiles), "Migration lock file set does not match src/app/migrations");
  for (const file of migrationFiles) {
    assert(lockFiles[file] === current[file], `Migration lock checksum mismatch: ${file}`);
  }
}

function checkWorkflowGates() {
  const workflowFiles = [
    ".github/workflows/ci.yml",
    ".github/workflows/release-gate.yml"
  ];
  const requiredSnippets = [
    "npm run ops:release:checklist",
    "npm run ops:migrate:smoke"
  ];

  for (const relativePath of workflowFiles) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const content = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    for (const snippet of requiredSnippets) {
      assert(content.includes(snippet), `${relativePath} is missing required gate: ${snippet}`);
    }
  }
}

function main() {
  checkPackageScripts();
  checkOpenApiArtifacts();
  checkPolicyAndRunbookDocs();
  checkCriticalTests();
  checkMigrationLock();
  checkWorkflowGates();
  console.log("Release checklist: OK");
}

try {
  main();
} catch (error) {
  console.error(`Release checklist: FAIL: ${error?.message || error}`);
  process.exit(1);
}
