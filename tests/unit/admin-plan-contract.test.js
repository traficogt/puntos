import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planFeaturesWithOverrides, planLimits } from "../../src/utils/plan.js";

describe("admin plan response contract", () => {
  it("reflects tightened EMPRENDEDOR defaults without overrides", () => {
    const features = planFeaturesWithOverrides("EMPRENDEDOR", {});
    const limits = planLimits("EMPRENDEDOR");

    assert.equal(features.lifecycle_automation, false);
    assert.equal(features.analytics, false);
    assert.equal(features.rewards, true);
    assert.equal(limits.branches, 1);
  });
});
