import { test } from "node:test";
import assert from "node:assert/strict";

import { cookieOpts, cookieOptsWith } from "../../src/utils/auth-token.js";

test("cookie opts force secure cookies for HTTPS requests even when local fallback origins are configured", () => {
  const req = {
    secure: false,
    protocol: "http",
    headers: {
      "x-forwarded-proto": "https"
    },
    get(name) {
      return this.headers[String(name).toLowerCase()] || "";
    }
  };

  const staffCookie = cookieOpts(req);
  const superCookie = cookieOptsWith(req, { sameSite: "strict" });

  assert.equal(staffCookie.secure, true);
  assert.equal(superCookie.secure, true);
  assert.equal(staffCookie.path, "/");
  assert.equal(superCookie.sameSite, "strict");
});
