import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("server exposes runtime-config and disables static directory redirects", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../src/app/server.js", import.meta.url), "utf8");

  assert.match(source, /app\.get\("\/runtime-config\.js"/);
  assert.match(source, /app\.get\("\/sitio"/);
  assert.match(source, /app\.get\("\/ingresar\/:slug"/);
  assert.match(source, /express\.static\(publicDir,\s*\{[^}]*redirect:\s*false/);
});
