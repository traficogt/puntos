import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer-facing routes use /registro while preserving temporary compatibility for /join", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const joinHtml = fs.readFileSync(new URL("../../public/join.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const customerHtml = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const customerJs = fs.readFileSync(new URL("../../public/customer/index.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const adminJs = fs.readFileSync(new URL("../../public/admin.js", import.meta.url), "utf8");

  assert.match(customerHtml, /\/registro\/&lt;slug&gt;/);
  assert.match(customerJs, /location\.href = `\/registro\//);
  assert.match(adminJs, /\/registro\//);
  assert.doesNotMatch(customerHtml, /\/join\/&lt;slug&gt;/);
  assert.match(joinHtml, /Registro/);
});
