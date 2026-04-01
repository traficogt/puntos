import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("package scripts expose the rollback and release snapshot commands", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.scripts["ops:release:snapshot"], "node src/scripts/release-snapshot.mjs");
  assert.equal(pkg.scripts["ops:release:tag-local"], "bash src/scripts/tag-local-release.sh");
  assert.equal(pkg.scripts["ops:rollback:local-image"], "bash src/scripts/rollback-local-image.sh");
  assert.equal(pkg.scripts["ops:rollback:verify"], "node src/scripts/rollback-verify.mjs");
});

test("rollback runbook documents the concrete local-image rollback flow", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const doc = fs.readFileSync(new URL("../../docs/ROLLBACK_RUNBOOK.md", import.meta.url), "utf8");

  assert.match(doc, /ops:release:tag-local/);
  assert.match(doc, /ops:release:snapshot/);
  assert.match(doc, /ops:rollback:local-image/);
  assert.match(doc, /ops:rollback:verify/);
  assert.match(doc, /artifacts\/releases\/release_snapshot_/);
  assert.match(doc, /artifacts\/rollback-verifications\/rollback_verify_/);
});
