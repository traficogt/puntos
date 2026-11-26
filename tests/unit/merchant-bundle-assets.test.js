import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// The merchant browser specs build fixtures into public/merchant/recursos with
// emptyOutDir, so a commit staged after a test run and before `npm --prefix
// web/merchant run build` ships an index.html whose chunks do not exist. The owner
// app then renders a blank page. This guard fails the unit gate in that state.
const root = path.resolve(import.meta.dirname, "../..");
const indexPath = path.join(root, "public/merchant/index.html");

test("every bundle asset referenced by the merchant index.html exists on disk", () => {
  const html = readFileSync(indexPath, "utf8");
  const refs = [...html.matchAll(/(?:src|href)="\/negocio\/recursos\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, "index.html should reference the entry script and stylesheet");
  const missing = refs.filter(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative test path
    (file) => !existsSync(path.join(root, "public/merchant/recursos", file)),
  );
  assert.deepEqual(
    missing,
    [],
    `Missing merchant bundle files; run \`npm --prefix web/merchant run build\` before committing: ${missing.join(", ")}`,
  );
});
