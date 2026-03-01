import test from "node:test";
import assert from "node:assert/strict";
import { decryptProgramSecrets, encryptProgramSecrets } from "../../src/utils/program-secrets.js";

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
