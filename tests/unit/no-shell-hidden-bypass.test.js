import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../../", import.meta.url);
const FILES = [
  "public/customer/load.js",
  "public/customer/me.js",
  "public/admin-dashboard/session-controller.js",
  "public/super/index.js"
];

const BLOCKED_PATTERNS = [
  /\#needLogin["'`)]\s*[^;\n]*\.hidden\s*=/,
  /\#main["'`)]\s*[^;\n]*\.hidden\s*=/,
  /\#btnLogout["'`)]\s*[^;\n]*\.hidden\s*=/
];

test("shell visibility uses the shared helper instead of raw hidden writes", () => {
  for (const file of FILES) {
    const fullPath = new URL(file, ROOT);
    // Test reads a fixed allowlist of repo files.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const source = fs.readFileSync(fullPath, "utf8");

    for (const pattern of BLOCKED_PATTERNS) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.basename(file)} still toggles a shared shell with raw .hidden`
      );
    }
  }
});
