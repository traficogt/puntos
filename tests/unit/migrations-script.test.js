import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("migrations wrapper applies managed migrations on the apply command", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../src/scripts/migrations.mjs", import.meta.url), "utf8");

  assert.match(source, /runManagedMigrations/);
  assert.match(source, /if \(cmd === "apply"\) \{[\s\S]*await initDatabase\(\);[\s\S]*await runManagedMigrations\(\);[\s\S]*await printStatus\(\);/);
});
