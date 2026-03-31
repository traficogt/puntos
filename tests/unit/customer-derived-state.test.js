import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  calculateVisitStreakMetrics,
  computePurchaseFrequencyPerMonth
} = await import("../../src/app/services/customer-derived-state.js");

describe("customer derived state helpers", () => {
  it("calculates purchase frequency across active months", () => {
    const frequency = computePurchaseFrequencyPerMonth(
      6,
      "2026-01-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z"
    );
    assert.ok(frequency > 2.9 && frequency < 3.1);
  });

  it("builds current and longest streaks from distinct visit dates", () => {
    const streak = calculateVisitStreakMetrics([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-06",
      "2026-03-07"
    ]);
    assert.deepEqual(streak, {
      currentStreak: 2,
      longestStreak: 3,
      lastVisitDate: "2026-03-07",
      streakStartedAt: "2026-03-06"
    });
  });

  it("returns empty streak metrics when there are no visits", () => {
    assert.deepEqual(calculateVisitStreakMetrics([]), {
      currentStreak: 0,
      longestStreak: 0,
      lastVisitDate: null,
      streakStartedAt: null
    });
  });
});
