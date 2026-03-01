import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config/index.js";
import { decryptSecretMaybe, encryptSecret, isEncryptedSecret, rotateSecretToCurrent } from "../../src/utils/secret-crypto.js";

test("encryptSecret/decryptSecretMaybe round trip", () => {
  const plain = "super-secret-value-123";
  const enc = encryptSecret(plain);
  assert.equal(isEncryptedSecret(enc), true);
  assert.notEqual(enc, plain);
  const dec = decryptSecretMaybe(enc);
  assert.equal(dec, plain);
});

test("decryptSecretMaybe keeps plaintext values unchanged", () => {
  const plain = "legacy-plain-secret";
  assert.equal(decryptSecretMaybe(plain), plain);
});

test("decryptSecretMaybe supports previous key during rotation", () => {
  const prevCurrent = config.WEBHOOK_SECRET_ENC_KEY;
  const prevKeys = config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS;
  try {
    config.WEBHOOK_SECRET_ENC_KEY = "old-key-material";
    config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS = [];
    const encryptedWithOld = encryptSecret("rotate-me");

    config.WEBHOOK_SECRET_ENC_KEY = "new-key-material";
    config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS = ["old-key-material"];
    assert.equal(decryptSecretMaybe(encryptedWithOld), "rotate-me");

    const rotated = rotateSecretToCurrent(encryptedWithOld);
    assert.match(rotated, /^enc:v2:/);
    assert.equal(decryptSecretMaybe(rotated), "rotate-me");
  } finally {
    config.WEBHOOK_SECRET_ENC_KEY = prevCurrent;
    config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS = prevKeys;
  }
});
