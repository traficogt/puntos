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


import { describe as _d2, it as _it2 } from "node:test";
import assert2 from "node:assert/strict";
import { totp as _totp2, verifyTotpCounter as _vc2 } from "../../src/utils/totp.js";
_d2("verifyTotpCounter (single-use support)", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  _it2("returns the matched time-step counter for a valid code", () => {
    const now = 1_700_000_000_000;
    const code = _totp2(secret, { nowMs: now });
    const counter = _vc2(secret, code, { nowMs: now });
    assert2.equal(counter, Math.floor(now / 1000 / 30));
  });
  _it2("returns null for an invalid code", () => {
    const now = 1_700_000_000_000;
    assert2.equal(_vc2(secret, "000000", { nowMs: now }), null);
    assert2.equal(_vc2(secret, "abc", { nowMs: now }), null);
  });
  _it2("same code maps to the same counter (so a replay is detectable)", () => {
    const now = 1_700_000_000_000;
    const code = _totp2(secret, { nowMs: now });
    assert2.equal(_vc2(secret, code, { nowMs: now }), _vc2(secret, code, { nowMs: now + 1000 }));
  });
});
