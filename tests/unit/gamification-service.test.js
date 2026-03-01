import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { GamificationService } = await import("../../src/app/services/gamification-service.js");
const { GamificationRepository } = await import("../../src/app/repositories/gamification-repository.js");

describe("gamification defaults", () => {
  it("creates default achievements with integer requirement values", async () => {
    const originalCreate = GamificationRepository.createAchievement;
    const created = [];

    GamificationRepository.createAchievement = async (payload) => {
      created.push(payload);
      return payload;
    };

    try {
      await GamificationService.createDefaultAchievements("biz-test");
    } finally {
      GamificationRepository.createAchievement = originalCreate;
    }

    assert.ok(created.length > 0, "default achievements were seeded");
    for (const ach of created) {
      assert.equal(Number.isInteger(ach.requirement_value), true, `requirement_value must be integer for '${ach.name}'`);
    }
    assert.equal(created[0].name, "First Purchase");
    assert.equal(created[0].requirement_value, 1);
  });
});
