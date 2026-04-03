process.env.NODE_ENV = "test";
process.env.JWT_SECRET_FILE = "";
process.env.JWT_SECRET = "test-jwt-secret-abcdefghijklmnopqrstuvwxyz";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

const { verifyJoinCode } = await import("../../src/app/services/customer-service.js");
const {
  pool,
  getDbTenantId,
  getDbPlatformAdmin
} = await import("../../src/app/database.js");
const { VerifyCodeRepo } = await import("../../src/app/repositories/verify-code-repository.js");
const { CustomerRepo } = await import("../../src/app/repositories/customer-repository.js");

describe("customer service tenant context", () => {
  it("verifies customer codes inside the business tenant db context", async () => {
    const business = { id: "biz-test", slug: "test-cafe", name: "Test Café" };
    const phone = "55555558";
    const code = "123456";
    const codeHash = await bcrypt.hash(code, 4);

    const originalConnect = pool.connect;
    const originalLatestValid = VerifyCodeRepo.latestValid;
    const originalDeleteById = VerifyCodeRepo.deleteById;
    const originalGetByBusinessAndPhone = CustomerRepo.getByBusinessAndPhone;
    const originalUpdateName = CustomerRepo.updateName;

    const seenTenants = [];
    const seenPlatforms = [];

    pool.connect = async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    });

    VerifyCodeRepo.latestValid = async () => {
      seenTenants.push(getDbTenantId());
      seenPlatforms.push(getDbPlatformAdmin());
      return { id: "vc-test", code_hash: codeHash };
    };
    VerifyCodeRepo.deleteById = async () => {
      seenTenants.push(getDbTenantId());
      seenPlatforms.push(getDbPlatformAdmin());
    };
    CustomerRepo.getByBusinessAndPhone = async () => {
      seenTenants.push(getDbTenantId());
      seenPlatforms.push(getDbPlatformAdmin());
      return {
        id: "cust-test",
        business_id: business.id,
        phone,
        name: null,
        points: 0
      };
    };
    CustomerRepo.updateName = async () => {
      seenTenants.push(getDbTenantId());
      seenPlatforms.push(getDbPlatformAdmin());
    };

    try {
      const out = await verifyJoinCode({
        business,
        phone,
        code,
        name: "Cliente Test",
        referralCode: null,
        requireExisting: false
      });

      assert.equal(out.customer.id, "cust-test");
      assert.deepEqual(seenTenants, [business.id, business.id, business.id, business.id]);
      assert.deepEqual(seenPlatforms, [false, false, false, false]);
    } finally {
      pool.connect = originalConnect;
      VerifyCodeRepo.latestValid = originalLatestValid;
      VerifyCodeRepo.deleteById = originalDeleteById;
      CustomerRepo.getByBusinessAndPhone = originalGetByBusinessAndPhone;
      CustomerRepo.updateName = originalUpdateName;
    }
  });
});
