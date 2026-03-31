import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("CORS middleware is scoped to API routes, not global static assets", () => {
  // Static path is fixed by the test file layout.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../src/app/server.js", import.meta.url), "utf8");

  assert.match(source, /app\.use\("\/api",\s*cors\(/);
  assert.doesNotMatch(source, /app\.use\(\s*cors\(/);
});
