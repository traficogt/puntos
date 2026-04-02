import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("helmet CSP allows intended hosted font sources and keeps frame-src coherent", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../src/app/server.js", import.meta.url), "utf8");

  assert.match(source, /styleSrc:\s*\[[^\]]*"https:\/\/fonts\.googleapis\.com"/);
  assert.match(source, /fontSrc:\s*\[[^\]]*"https:\/\/fonts\.gstatic\.com"/);
  assert.match(source, /frameSrc:\s*\[[^\]]*"https:\/\/challenges\.cloudflare\.com"[^\]]*\]/);
  assert.doesNotMatch(source, /frameSrc:\s*\[[^\]]*"'none'"/);
});
