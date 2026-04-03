import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("join page exposes inline feedback for request and verify actions", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/join.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/join.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const shared = fs.readFileSync(new URL("../../public/customer-auth-entry.js", import.meta.url), "utf8");

  assert.match(html, /id="joinRequestFeedback"/);
  assert.match(html, /id="joinVerifyFeedback"/);
  assert.match(html, /id="joinEntryContext"/);
  assert.match(html, /id="email"/);
  assert.match(js, /mode: "register"/);
  assert.match(shared, /setFeedback\("#joinRequestFeedback"/);
  assert.match(shared, /setFeedback\("#joinVerifyFeedback"/);
  assert.match(shared, /new URLSearchParams\(location\.search\)/);
  assert.match(shared, /Tu sesión anterior de .* ya venció\./);
  assert.match(shared, /Cerraste tu sesión de .* Solicita un nuevo código/);
  assert.doesNotMatch(shared, /out\.expiresAt/);
});
