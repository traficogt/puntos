import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { requireStaff } from "../../src/middleware/auth.js";
import { signStaffToken } from "../../src/utils/auth-token.js";
import { withImpersonationMeta } from "../../src/utils/impersonation.js";

describe("impersonation provenance", () => {
  it("adds impersonation metadata when present", () => {
    const meta = withImpersonationMeta({ action: "test" }, { impersonated_by: "super@example.com" });
    assert.deepEqual(meta, {
      action: "test",
      impersonated_by_super_admin_email: "super@example.com"
    });
  });

  it("preserves the impersonator on authenticated staff context", async () => {
    const token = await signStaffToken({
      sid: "staff-1",
      bid: "business-1",
      role: "OWNER",
      brid: "branch-1",
      imp: "super@example.com"
    });

    const req = /** @type {any} */ ({
      cookies: {
        pf_staff: token
      }
    });
    const res = /** @type {any} */ ({
      status() {
        throw new Error("should not reject");
      }
    });

    await new Promise((resolve, reject) => {
      requireStaff(req, res, (err) => (err ? reject(err) : resolve()));
    });

    assert.deepEqual(req.staff, {
      id: "staff-1",
      business_id: "business-1",
      role: "OWNER",
      branch_id: "branch-1",
      impersonated_by: "super@example.com"
    });
  });
});
