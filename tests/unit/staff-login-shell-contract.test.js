import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("staff login shell omits the redundant route and mode note stack", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/staff-login.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /entry-note-stack/);
  assert.doesNotMatch(html, /Escáner o panel/);
  assert.doesNotMatch(html, /Operación diaria/);
});
