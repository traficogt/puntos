import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { requireStaffPermission } from "../../src/middleware/auth.js";
import { Permission, Role } from "../../src/utils/permissions.js";

function makeReq(init = {}) {
  return /** @type {any} */ ({ method: "GET", url: "/", ...init });
}

function makeRes() {
  return /** @type {any} */ ({
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  });
}

describe("RBAC middleware", () => {
  it("returns 401 when no staff", () => {
    const req = makeReq({ method: "GET", url: "/api/staff/me" });
    const res = makeRes();
    let called = false;
    const next = () => {
      called = true;
    };

    requireStaffPermission(Permission.STAFF_AWARD)(req, res, next);
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload?.code, "AUTH_REQUIRED");
  });

  it("returns 403 when role lacks permission", () => {
    const req = makeReq({ method: "POST" });
    req.staff = { role: Role.CASHIER };
    const res = makeRes();
    let called = false;
    const next = () => {
      called = true;
    };

    requireStaffPermission(Permission.STAFF_REFUND)(req, res, next);
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload?.code, "RBAC_PERMISSION_DENIED");
  });

  it("calls next when role has permission", () => {
    const req = makeReq({ method: "POST" });
    req.staff = { role: Role.MANAGER };
    const res = makeRes();
    let called = false;
    const next = () => {
      called = true;
    };

    requireStaffPermission(Permission.STAFF_REFUND)(req, res, next);
    assert.equal(called, true);
  });
});

describe("RBAC route wiring", () => {
  it("guards critical staff routes with explicit permission checks", () => {
    const routesPath = path.join(process.cwd(), "src", "app", "routes", "staff-routes.js");
    const src = fs.readFileSync(routesPath, "utf8");
    assert.ok(src.includes("requireStaffPermission"), "Staff routes should use requireStaffPermission");
  });
});
