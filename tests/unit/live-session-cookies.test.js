import test from "node:test";
import assert from "node:assert/strict";
import { copyStaffSessionCookies } from "../../src/scripts/live-session-cookies.mjs";

for (const staffCookie of ["pf_staff", "__Host-pf_staff"]) {
  test(`live owner fixtures retain ${staffCookie} without platform privileges`, () => {
    const source = new Map([
      [staffCookie, "staff-session"],
      ["pf_csrf", "csrf-session"],
      ["pf_csrf_readable", "csrf-readable"],
      ["pf_super", "platform-session"],
      ["__Host-pf_super", "secure-platform-session"],
      ["pf_customer", "customer-session"],
      [`${staffCookie}_other`, "unrelated-session"]
    ]);
    const target = new Map();

    copyStaffSessionCookies(source, target);

    assert.deepEqual([...target], [
      [staffCookie, "staff-session"],
      ["pf_csrf", "csrf-session"],
      ["pf_csrf_readable", "csrf-readable"]
    ]);
  });
}
