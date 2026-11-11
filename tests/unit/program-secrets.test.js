import test from "node:test";
import assert from "node:assert/strict";
import * as programSecrets from "../../src/utils/program-secrets.js";
import { decryptProgramSecrets, encryptProgramSecrets, rotateProgramSecretsToCurrent } from "../../src/utils/program-secrets.js";
import { config } from "../../src/config/index.js";

const EXTERNAL_AWARD_KEY_FIELD = ["api", "key"].join("_");
const TEST_PROGRAM_TOKEN_A = "sandbox-program-token-alpha";
const TEST_PROGRAM_TOKEN_B = "sandbox-program-token-beta";

test("encryptProgramSecrets encrypts external award credential", () => {
  const input = {
    points_per_q: 0.1,
    external_awards: {
      enabled: true,
      [EXTERNAL_AWARD_KEY_FIELD]: TEST_PROGRAM_TOKEN_A
    }
  };
  const encrypted = encryptProgramSecrets(input);
  assert.notEqual(
    encrypted.external_awards[EXTERNAL_AWARD_KEY_FIELD],
    input.external_awards[EXTERNAL_AWARD_KEY_FIELD]
  );
  assert.match(encrypted.external_awards[EXTERNAL_AWARD_KEY_FIELD], /^enc:v[12]:/);
});

test("decryptProgramSecrets round-trips external award credential", () => {
  const input = {
    external_awards: {
      enabled: true,
      [EXTERNAL_AWARD_KEY_FIELD]: TEST_PROGRAM_TOKEN_B
    }
  };
  const encrypted = encryptProgramSecrets(input);
  const decrypted = decryptProgramSecrets(encrypted);
  assert.equal(
    decrypted.external_awards[EXTERNAL_AWARD_KEY_FIELD],
    input.external_awards[EXTERNAL_AWARD_KEY_FIELD]
  );
});

test("POS access tokens are encrypted without mutating settings and can be decrypted", () => {
  const input = { pos_integration: { mode: "loyverse", loyverse: { access_token: "sandbox-pos-token", merchant_id: "merchant-1" } } };
  const encrypted = encryptProgramSecrets(input);
  assert.match(encrypted.pos_integration.loyverse.access_token, /^enc:v[12]:/);
  assert.equal(input.pos_integration.loyverse.access_token, "sandbox-pos-token");
  assert.equal(encrypted.pos_integration.loyverse.merchant_id, "merchant-1");
  assert.deepEqual(decryptProgramSecrets(encrypted), input);
});

test("program sanitizer removes the POS connection and API key without mutating stored settings", () => {
  const input = {
    points_per_q: 2,
    external_awards: { enabled: true, api_key: TEST_PROGRAM_TOKEN_A },
    pos_integration: { automatic: true, loyverse: { access_token: "sandbox-pos-token" }, last_sync: { errors: 1 } }
  };
  const before = structuredClone(input);
  assert.equal(typeof programSecrets.sanitizeProgramForClient, "function");
  const result = programSecrets.sanitizeProgramForClient(input);
  assert.deepEqual(result, { points_per_q: 2, external_awards: { enabled: true } });
  assert.deepEqual(input, before);
});

test("unavailable POS encryption keys preserve ciphertext without mutating input", () => {
  const input = { pos_integration: { loyverse: { access_token: "enc:v2:unreadable:tag:value" } } };
  assert.deepEqual(decryptProgramSecrets(input), input);
});

test("POS-only programs rotate credentials to the current key", () => {
  const previousCurrent = config.WEBHOOK_SECRET_ENC_KEY;
  const previousKeys = config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS;
  try {
    config.WEBHOOK_SECRET_ENC_KEY = "sandbox-old-program-key";
    config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS = [];
    const encrypted = encryptProgramSecrets({ pos_integration: { loyverse: { access_token: "sandbox-pos-rotation" } } });
    config.WEBHOOK_SECRET_ENC_KEY = "sandbox-new-program-key";
    config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS = ["sandbox-old-program-key"];
    const rotated = rotateProgramSecretsToCurrent(encrypted);
    assert.notEqual(rotated.pos_integration.loyverse.access_token, encrypted.pos_integration.loyverse.access_token);
    config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS = [];
    assert.equal(decryptProgramSecrets(rotated).pos_integration.loyverse.access_token, "sandbox-pos-rotation");
  } finally {
    config.WEBHOOK_SECRET_ENC_KEY = previousCurrent;
    config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS = previousKeys;
  }
});
