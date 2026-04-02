import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer return page keeps only registro entry feedback after removing inline pseudo-login", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/customer/index.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const loadJs = fs.readFileSync(new URL("../../public/customer/load.js", import.meta.url), "utf8");

  assert.match(html, /id="joinFeedback"/);
  assert.match(js, /setEntryFeedback\(\$, "#joinFeedback"/);
  assert.doesNotMatch(html, /id="loginFeedback"/);
  assert.doesNotMatch(js, /btnSendLoginCode|btnLoginVerify|loginFeedback/);
  assert.match(loadJs, /location\.href = `\/registro\/\$\{encodeURIComponent\(cachedSlug\)\}`|location\.href = `\/registro\/\$\{encodeURIComponent\(cachedSlug\)\}`/);
});
