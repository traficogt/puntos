process.env.NODE_ENV = "test";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import {
  hashPassword,
  isArgon2Hash,
  isBcryptHash,
  needsPasswordRehash,
  verifyPassword
} from "../../src/utils/password-hash.js";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  assertPasswordAllowed,
  passwordPolicyErrors
} from "../../src/utils/password-policy.js";
import { businessRegisterSchema } from "../../src/utils/schemas.js";

describe("password security", () => {
  it("verifies fixed password hashes created before the dependency upgrade", async () => {
    // Synthetic fixtures created with bcryptjs 2.4.3 and argon2 0.44.0.
    const password = "Dependency migration legacy fixture";
    for (const hash of ["$2a$04$XGrJ1nL0DzzwysIb7ngSke5TVIKdCRQ104oAZqcuOwwy2OsCAzCM.", "$argon2id$v=19$m=19456,t=2,p=1$dimD8DtrvoyeZ3i0S98Fww$PVK/nNQ+8n4h1I7uN3BfpkV1woWU4mJJ3XHMc5VmENo"]) {
      assert.equal(await verifyPassword(password, hash), true);
      assert.equal(await verifyPassword("incorrect fixture password", hash), false);
    }
  });

  it("hashes new passwords with argon2id and verifies them", async () => {
    const password = "Correct horse battery staple 2026";
    const hash = await hashPassword(password);

    assert.equal(isArgon2Hash(hash), true);
    assert.equal(isBcryptHash(hash), false);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword("wrong password", hash), false);
    assert.equal(needsPasswordRehash(hash), false);
  });

  it("accepts legacy bcrypt hashes and marks them for rehash", async () => {
    const password = "Legacy password value 2026";
    const hash = await bcrypt.hash(password, 10);

    assert.equal(isBcryptHash(hash), true);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(needsPasswordRehash(hash), true);
  });

  it("rejects common and context-derived passwords", () => {
    assert.match(
      passwordPolicyErrors("password123", {}).join(" "),
      /too common/i
    );
    assert.match(
      passwordPolicyErrors("CafeOwner-example-com-2026", {
        email: "owner@example.com",
        businessName: "Cafe Owner"
      }).join(" "),
      /account or app context/i
    );
  });

  it("allows long passphrases without composition rules", () => {
    assert.doesNotThrow(() => {
      assertPasswordAllowed("cafe con leche para todos 2026", {
        email: "owner@example.com",
        businessName: "Bean House"
      });
    });
  });

  it("enforces the new length bounds in the registration schema", () => {
    assert.equal(PASSWORD_MIN_LENGTH, 8);
    assert.equal(PASSWORD_MAX_LENGTH >= 64, true);

    const base = {
      name: "Demo Coffee",
      slug: "demo-coffee",
      email: "owner@example.com",
      phone: "12345678"
    };

    assert.equal(businessRegisterSchema.safeParse({
      ...base,
      password: "short7"
    }).success, false);

    assert.equal(businessRegisterSchema.safeParse({
      ...base,
      password: "valid passphrase 2026"
    }).success, true);
  });
});
