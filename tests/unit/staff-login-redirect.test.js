import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("staff login client redirects owners to the dashboard and staff to the scanner", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/staff-login.js", import.meta.url), "utf8");

  assert.match(source, /out\s*=\s*await api\("\/api\/staff\/login"/);
  assert.match(source, /role === "OWNER" \? "\/admin-dashboard" : "\/staff"/);
  assert.match(source, /Abriendo panel/);
  assert.match(source, /Abriendo escáner/);
});
