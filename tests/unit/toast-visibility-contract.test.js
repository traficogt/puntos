import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("toast uses an explicit visible class so feedback is not hidden by base CSS", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const libSource = fs.readFileSync(new URL("../../public/lib.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const cssSource = fs.readFileSync(new URL("../../public/styles/components.css", import.meta.url), "utf8");

  assert.match(libSource, /classList\.add\("is-visible"\)/);
  assert.match(libSource, /classList\.remove\("is-visible"\)/);
  assert.match(cssSource, /\.toast\.is-visible\s*\{/);
});
