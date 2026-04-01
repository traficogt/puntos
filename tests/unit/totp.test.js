import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildOtpAuthUri, decodeBase32, generateBase32Secret, totp, verifyTotp } from "../../src/utils/totp.js";

describe("totp utils", () => {
  it("generates verifiable six-digit codes", () => {
    const secret = generateBase32Secret();
    const code = totp(secret, { nowMs: 1_700_000_000_000 });
    assert.match(code, /^\d{6}$/);
    assert.equal(verifyTotp(secret, code, { nowMs: 1_700_000_000_000 }), true);
    assert.equal(verifyTotp(secret, "000000", { nowMs: 1_700_000_000_000 }), false);
  });

  it("decodes base32 secrets and builds otpauth URIs", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const decoded = decodeBase32(secret);
    assert.ok(Buffer.isBuffer(decoded));
    assert.ok(decoded.length > 0);
    const uri = buildOtpAuthUri({
      issuer: "PuntosFieles",
      label: "owner@example.com",
      secret
    });
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /issuer=PuntosFieles/);
    assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  });
});
