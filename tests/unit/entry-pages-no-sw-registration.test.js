import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("transitional entry pages do not register the service worker", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const staffLogin = fs.readFileSync(new URL("../../public/staff-login.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const join = fs.readFileSync(new URL("../../public/join.js", import.meta.url), "utf8");

  assert.doesNotMatch(staffLogin, /registerServiceWorker\(/);
  assert.doesNotMatch(join, /registerServiceWorker\(/);
});
