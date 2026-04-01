import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { GamificationService } = await import("../../src/app/services/gamification-service.js");
const { GamificationRepository } = await import("../../src/app/repositories/gamification-repository.js");
const { pool } = await import("../../src/app/db/pools.js");
const { achievementProgressValue } = await import("../../src/app/services/gamification/achievements-service.js");
const {
  hasRecurringWindowElapsed,
  calculateMilestoneCompletionDelta,
  updateChallengeProgress
} = await import("../../src/app/services/gamification/challenges-service.js");
const {
  expectedNonRecurringChallengeCompletions,
  shouldRevokeRecurringChallengeCompletion
} = await import("../../src/app/services/gamification/reconciliation-service.js");

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

describe("achievement progress values", () => {
  it("supports item-based achievements", () => {
    const value = achievementProgressValue({ total_items: 14 }, "items");
    assert.equal(value, 14);
  });
});

describe("challenge recurrence windows", () => {
  it("blocks repeated daily completions within the same day", () => {
    const now = new Date("2026-03-07T18:00:00.000Z");
    assert.equal(
      hasRecurringWindowElapsed("2026-03-07T09:00:00.000Z", "daily", now),
      false
    );
  });

  it("allows recurring completions after the window rolls over", () => {
    const now = new Date("2026-03-08T00:01:00.000Z");
    assert.equal(
      hasRecurringWindowElapsed("2026-03-07T23:30:00.000Z", "daily", now),
      true
    );
    assert.equal(
      hasRecurringWindowElapsed("2026-03-01T12:00:00.000Z", "weekly", new Date("2026-03-09T00:00:00.000Z")),
      true
    );
  });
});

describe("challenge completion math", () => {
  it("only awards when crossing new non-recurring milestones", () => {
    assert.equal(
      calculateMilestoneCompletionDelta({
        previousProgress: 10,
        newProgress: 12,
        requirementValue: 10,
        timesCompleted: 1
      }),
      0
    );

    assert.equal(
      calculateMilestoneCompletionDelta({
        previousProgress: 19,
        newProgress: 21,
        requirementValue: 10,
        timesCompleted: 1
      }),
      1
    );
  });

  it("caps milestone completions at max_completions", () => {
    assert.equal(
      calculateMilestoneCompletionDelta({
        previousProgress: 0,
        newProgress: 40,
        requirementValue: 10,
        timesCompleted: 0,
        maxCompletions: 2
      }),
      2
    );
  });
});

describe("recurring challenge state transitions", () => {
  it("blocks repeat completion in the same window and allows completion after rollover", async () => {
    const originalConnect = pool.connect;
    const originalListActiveChallenges = GamificationRepository.listActiveChallenges;
    const originalGetCustomerChallengeProgress = GamificationRepository.getCustomerChallengeProgress;
    const originalResetRecurringChallengeProgress = GamificationRepository.resetRecurringChallengeProgress;
    const originalUpdateChallengeProgress = GamificationRepository.updateChallengeProgress;
    const originalCompleteChallengeForCustomer = GamificationRepository.completeChallengeForCustomer;
    const originalDate = global.Date;

    const challenge = {
      id: "challenge-1",
      business_id: "biz-1",
      name: "Daily Visits",
      requirement_type: "visits",
      requirement_value: 1,
      reward_points: 5,
      recurrence: "daily",
      max_completions: null
    };

    const progressState = {
      progress: 0,
      completed: false,
      completed_at: null,
      last_reset_at: null,
      times_completed: 0,
      last_source_transaction_id: null,
      last_reward_transaction_id: null,
      completion_history: []
    };
    const updates = [];
    const resets = [];
    const completions = [];
    let transactionInsertCount = 0;

    const fakeClient = {
      async query(sql, _params) {
        const text = String(sql);
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [], rowCount: 0 };
        if (text.includes("set_config(")) return { rows: [], rowCount: 0 };
        if (text.includes("SELECT status, reversed_transaction_id")) {
          return { rows: [{ status: "POSTED", reversed_transaction_id: null }], rowCount: 1 };
        }
        if (text.includes("SELECT business_id FROM customers")) {
          return { rows: [{ business_id: "biz-1" }], rowCount: 1 };
        }
        if (text.includes("UPDATE customer_balances")) return { rows: [], rowCount: 1 };
        if (text.includes("INSERT INTO transactions")) {
          transactionInsertCount += 1;
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL in recurring challenge test: ${text}`);
      },
      release() {}
    };

    pool.connect = async () => fakeClient;
    GamificationRepository.listActiveChallenges = async () => [challenge];
    GamificationRepository.getCustomerChallengeProgress = async () => ({ ...progressState });
    GamificationRepository.resetRecurringChallengeProgress = async () => {
      resets.push({ at: new Date().toISOString() });
      progressState.progress = 0;
      progressState.completed = false;
      progressState.completed_at = null;
      progressState.last_reset_at = new Date().toISOString();
      return { ...progressState };
    };
    GamificationRepository.updateChallengeProgress = async (_customerId, _challengeId, progress) => {
      updates.push(progress);
      progressState.progress = progress;
      return { ...progressState };
    };
    GamificationRepository.completeChallengeForCustomer = async (_customerId, _challengeId, completion) => {
      completions.push(completion);
      progressState.completed = true;
      progressState.completed_at = completion.completedAt;
      progressState.times_completed += 1;
      progressState.last_source_transaction_id = completion.sourceTransactionId || null;
      progressState.last_reward_transaction_id = completion.rewardTransactionId || null;
      progressState.completion_history = [
        ...(progressState.completion_history || []),
        completion.historyEntry
      ];
      return { ...progressState };
    };

    function setFakeNow(isoString) {
      const fixed = new originalDate(isoString);
      global.Date = /** @type {DateConstructor} */ (class FakeDate extends originalDate {
        constructor(...args) {
          super(args.length ? String(args[0]) : fixed.toISOString());
        }
        static now() {
          return fixed.getTime();
        }
        static parse(value) {
          return originalDate.parse(value);
        }
        static UTC(...args) {
          return originalDate.UTC.apply(originalDate, args);
        }
      });
    }

    try {
      setFakeNow("2026-03-07T10:00:00.000Z");
      const first = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-1" });
      assert.equal(first.length, 1);
      assert.equal(progressState.times_completed, 1);
      assert.equal(transactionInsertCount, 1);
      assert.equal(completions.length, 1);
      assert.equal(progressState.last_source_transaction_id, "tx-1");

      setFakeNow("2026-03-07T18:00:00.000Z");
      const second = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-2" });
      assert.equal(second.length, 0);
      assert.equal(progressState.times_completed, 1);
      assert.equal(transactionInsertCount, 1);
      assert.equal(resets.length, 0);

      setFakeNow("2026-03-08T09:00:00.000Z");
      const third = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-3" });
      assert.equal(third.length, 1);
      assert.equal(progressState.times_completed, 2);
      assert.equal(transactionInsertCount, 2);
      assert.equal(resets.length, 1);
      assert.equal(completions.length, 2);
      assert.equal(progressState.last_source_transaction_id, "tx-3");
      assert.equal(progressState.completion_history.length, 2);
      assert.deepEqual(updates, [1, 1]);
    } finally {
      pool.connect = originalConnect;
      GamificationRepository.listActiveChallenges = originalListActiveChallenges;
      GamificationRepository.getCustomerChallengeProgress = originalGetCustomerChallengeProgress;
      GamificationRepository.resetRecurringChallengeProgress = originalResetRecurringChallengeProgress;
      GamificationRepository.updateChallengeProgress = originalUpdateChallengeProgress;
      GamificationRepository.completeChallengeForCustomer = originalCompleteChallengeForCustomer;
      global.Date = originalDate;
    }
  });
});

describe("refund reconciliation helpers", () => {
  it("computes expected non-recurring challenge completions from current progress", () => {
    assert.equal(expectedNonRecurringChallengeCompletions(27, 10), 2);
    assert.equal(expectedNonRecurringChallengeCompletions(27, 10, 1), 1);
  });

  it("revokes recurring completions when the same window no longer qualifies", () => {
    assert.equal(
      shouldRevokeRecurringChallengeCompletion({
        currentValue: 4,
        requirementValue: 5,
        completed: true,
        completedAt: "2026-03-07T10:00:00.000Z",
        recurrence: "daily",
        referenceAt: new Date("2026-03-07T18:00:00.000Z")
      }),
      true
    );

    assert.equal(
      shouldRevokeRecurringChallengeCompletion({
        currentValue: 4,
        requirementValue: 5,
        completed: true,
        completedAt: "2026-03-06T10:00:00.000Z",
        recurrence: "daily",
        referenceAt: new Date("2026-03-07T18:00:00.000Z")
      }),
      false
    );
  });
});
