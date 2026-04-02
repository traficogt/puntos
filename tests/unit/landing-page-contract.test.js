import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("landing page reveal sections are visible by default and only hide after JS opt-in", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const css = fs.readFileSync(new URL("../../public/styles/pages.css", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/index.js", import.meta.url), "utf8");

  assert.doesNotMatch(
    css,
    /body\.page-marketing\s+\.reveal\s*\{[^}]*opacity:\s*0/i,
    "marketing reveal blocks should not be hidden by default"
  );
  assert.match(
    css,
    /\.reveal\.reveal-ready\s*\{[\s\S]*opacity:\s*0/,
    "marketing reveal blocks should only hide after JS adds reveal-ready"
  );
  assert.match(
    js,
    /classList\.add\("reveal-ready"\)/,
    "landing script should opt reveal blocks into animation explicitly"
  );
});
