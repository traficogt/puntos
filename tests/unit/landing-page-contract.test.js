import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("landing content is never gated behind a scroll-reveal script", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/index.js", import.meta.url), "utf8");

  assert.doesNotMatch(html, /class="[^"]*\breveal\b/);
  assert.doesNotMatch(js, /classList\.add\("reveal-ready"\)/);
  assert.match(html, /<main\s+id="contenido"/);
  assert.match(html, /<noscript>/, "contact form explains the verification requirement without JavaScript");
});
