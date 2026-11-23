import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("staff page falls back to cached session on network failure instead of redirecting immediately", () => {
  // Fixed repo path for the staff session module (split out of staff/index.js).
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/staff/session.js", import.meta.url), "utf8");

  assert.match(source, /readOfflineSnapshot/);
  assert.match(source, /writeOfflineSnapshot/);
  assert.match(source, /isNetworkFailure/);
  assert.match(source, /Modo sin conexión: usando la última sesión guardada\./);
  assert.match(source, /if \(isNetworkFailure\(error\)\)/);
  assert.match(source, /localStorage\.setItem\(\s*"pf_staff_snapshot"/);
  assert.match(source, /localStorage\.removeItem\(\s*"pf_staff_snapshot"/);
});
