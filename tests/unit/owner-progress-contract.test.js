import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { GOAL_KEYS } from "../../src/app/services/owner-progress-service.js";

// The merchant app derives its "Cambiar meta" alternatives from its own goal
// list; the server validates POST /owner-progress/goal against GOAL_KEYS. Keep
// both sides identical so the UI never offers a goal the server rejects.
test("merchant owner-progress goal keys match the server contract", () => {
  // Fixed repo path for the merchant app module.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(
    new URL("../../web/merchant/src/owner-progress-model.ts", import.meta.url),
    "utf8",
  );
  const uiKeys = [...source.matchAll(/key:\s*["']([a-z_0-9]+)["']/g)].map((m) => m[1]);
  assert.ok(uiKeys.length > 0, "no goal keys found in owner-progress-model.ts");
  assert.deepEqual([...new Set(uiKeys)].sort(), [...GOAL_KEYS].sort());
});
