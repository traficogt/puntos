import fs from "node:fs";
import path from "node:path";
/* eslint security/detect-non-literal-fs-filename: off */

const ROOT = process.cwd();
const TARGET_DIRS = ["src/app", "public", "src/middleware", "src/utils", "src/scripts"];
const SKIP_FILES = new Set([path.join(ROOT, "src", "scripts", "security-scan.mjs")]);
const SKIP_DIRS = new Set(["node_modules", ".git", "playwright-report", "test-results"]);
const JS_EXT = new Set([".js", ".mjs", ".cjs"]);

const RULES = [
  {
    name: "dangerous-dom-sink",
    re: /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/,
    message: "Potential XSS sink found. Prefer DOM nodes + textContent."
  },
  {
    name: "dynamic-code-exec",
    re: /\b(eval|new Function)\s*\(/,
    message: "Dynamic code execution is blocked."
  }
];

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!JS_EXT.has(path.extname(entry.name))) continue;
    acc.push(full);
  }
}

function scanFile(file) {
  if (SKIP_FILES.has(file)) return [];
  const src = fs.readFileSync(file, "utf8");
  const issues = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    const codeOnly = line.includes("//") ? line.slice(0, line.indexOf("//")) : line;
    for (const rule of RULES) {
      if (rule.re.test(codeOnly)) {
        issues.push({ file, line: i + 1, rule: rule.name, message: rule.message, snippet: line.trim() });
      }
    }
  }
  return issues;
}

const files = [];
for (const rel of TARGET_DIRS) {
  const dir = path.join(ROOT, rel);
  if (fs.existsSync(dir)) walk(dir, files);
}

const issues = files.flatMap(scanFile);
if (!issues.length) {
  console.log("Security scan passed: no blocked patterns found.");
  process.exit(0);
}

console.error(`Security scan failed with ${issues.length} issue(s):`);
for (const issue of issues) {
  const rel = path.relative(ROOT, issue.file);
  console.error(`- ${rel}:${issue.line} [${issue.rule}] ${issue.message}`);
  console.error(`  ${issue.snippet}`);
}
process.exit(1);
