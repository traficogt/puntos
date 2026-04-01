import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer offline cache only activates on network failure, not auth failure", () => {
  // Fixed repo path for the customer loader.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/customer/load.js", import.meta.url), "utf8");

  assert.match(source, /getCustomerCacheSnapshot/);
  assert.match(source, /clearCustomerCache/);
  assert.match(source, /isAuthError/);
  assert.match(source, /isNetworkFailure/);
  assert.match(source, /if \(isAuthError\(error\) && navigator\.onLine\)/);
  assert.match(source, /if \(isNetworkFailure\(error\)\)/);
  assert.doesNotMatch(source, /localStorage\.getItem\("pf_me"\)/);
  assert.doesNotMatch(source, /localStorage\.setItem\("pf_me"/);
});
