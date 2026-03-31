import test from "node:test";
import assert from "node:assert/strict";

import { isAllowedApiOrigin } from "../../src/utils/cors-origin.js";

test("allows requests whose browser origin exactly matches the current host origin", () => {
  assert.equal(
    isAllowedApiOrigin("http://localhost:3001", ["https://1testdomene.xyz"], "http://localhost:3001"),
    true
  );
});

test("allows configured origins even when different from the current host", () => {
  assert.equal(
    isAllowedApiOrigin("https://1testdomene.xyz", ["https://1testdomene.xyz"], "http://localhost:3001"),
    true
  );
});

test("rejects origins that are neither configured nor same-origin", () => {
  assert.equal(
    isAllowedApiOrigin("https://evil.example", ["https://1testdomene.xyz"], "http://localhost:3001"),
    false
  );
});
