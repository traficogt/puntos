import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("join page exposes inline feedback for request and verify actions", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/join.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/join.js", import.meta.url), "utf8");

  assert.match(html, /id="joinRequestFeedback"/);
  assert.match(html, /id="joinVerifyFeedback"/);
  assert.match(js, /setFeedback\("#joinRequestFeedback"/);
  assert.match(js, /setFeedback\("#joinVerifyFeedback"/);
  assert.doesNotMatch(js, /out\.expiresAt/);
});
