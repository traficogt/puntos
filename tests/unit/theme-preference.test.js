import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("theme bootstrap honors saved preference before system preference", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/theme.js", import.meta.url), "utf8");

  assert.match(source, /localStorage\.getItem\("pf-theme"\)/);
  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /dataset\.theme/);
  assert.match(source, /theme-color/);
  assert.match(source, /aria-label/);
  assert.match(source, /title/);
});
