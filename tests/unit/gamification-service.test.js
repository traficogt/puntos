import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";

const { GamificationService } = await import("../../src/app/services/gamification-service.js");
const { GamificationRepository } = await import("../../src/app/repositories/gamification-repository.js");
const { transactionPool } = await import("../../src/app/db/pools.js");
const { achievementProgressValue, checkAndAwardAchievements } = await import("../../src/app/services/gamification/achievements-service.js");
const { recurrenceWindowStart, recurrenceWindowEnd } = await import("../../src/app/services/gamification/recurrence-window.js");
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

  it("measures points earned and the best streak, not the spendable balance or running streak", () => {
    // Reached 1,000 points, redeemed 900; the streak has since broken.
    const stats = { points: 200, lifetime_points: 1100, current_streak: 1, longest_streak: 7 };
    assert.equal(achievementProgressValue(stats, "points"), 1100);
    assert.equal(achievementProgressValue(stats, "streak"), 7);
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
    const now = new Date("2026-03-08T06:01:00.000Z");
    assert.equal(
      hasRecurringWindowElapsed("2026-03-08T05:30:00.000Z", "daily", now),
      true
    );
    assert.equal(
      hasRecurringWindowElapsed("2026-03-01T12:00:00.000Z", "weekly", new Date("2026-03-09T06:00:00.000Z")),
      true
    );
    assert.equal(
      hasRecurringWindowElapsed("2026-03-07T23:30:00.000Z", "daily", new Date("2026-03-08T00:01:00.000Z"), "UTC"),
      true
    );
  });

  it("rolls daily windows over at local midnight in Guatemala, not at 18:00", () => {
    // 17:00 and 19:00 on 16 Nov in Guatemala (UTC-6) are the same local day.
    const fivePm = "2026-11-16T23:00:00.000Z";
    const sevenPm = new Date("2026-11-17T01:00:00.000Z");
    assert.equal(hasRecurringWindowElapsed(fivePm, "daily", sevenPm), false);
    assert.equal(hasRecurringWindowElapsed(fivePm, "daily", sevenPm, "America/Guatemala"), false);
    assert.equal(recurrenceWindowStart(sevenPm, "daily", "America/Guatemala").toISOString(), "2026-11-16T06:00:00.000Z");
    // Local midnight starts the next day.
    assert.equal(hasRecurringWindowElapsed(fivePm, "daily", new Date("2026-11-17T06:00:00.000Z"), "America/Guatemala"), true);
  });

  it("uses local Monday weeks and local month ends", () => {
    // Sunday 15 Nov 23:00 local is still the week that began Monday 9 Nov.
    assert.equal(recurrenceWindowStart("2026-11-16T05:00:00.000Z", "weekly", "America/Guatemala").toISOString(), "2026-11-09T06:00:00.000Z");
    // 30 Nov 19:00 local belongs to November although it is already 1 Dec in UTC.
    const novemberEvening = "2026-12-01T01:00:00.000Z";
    const monthStart = recurrenceWindowStart(novemberEvening, "monthly", "America/Guatemala");
    assert.equal(monthStart.toISOString(), "2026-11-01T06:00:00.000Z");
    assert.equal(recurrenceWindowEnd(monthStart, "monthly", "America/Guatemala").toISOString(), "2026-12-01T06:00:00.000Z");
    assert.equal(hasRecurringWindowElapsed("2026-11-20T15:00:00.000Z", "monthly", new Date(novemberEvening), "America/Guatemala"), false);
    assert.equal(hasRecurringWindowElapsed(novemberEvening, "monthly", new Date("2026-12-01T06:00:00.000Z"), "America/Guatemala"), true);
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

function installRecurringChallengeHarness(challenge) {
  const originalConnect = transactionPool.connect;
  const originalListActiveChallenges = GamificationRepository.listActiveChallenges;
  const originalGetCustomerChallengeProgress = GamificationRepository.getCustomerChallengeProgress;
  const originalResetRecurringChallengeProgress = GamificationRepository.resetRecurringChallengeProgress;
  const originalUpdateChallengeProgress = GamificationRepository.updateChallengeProgress;
  const originalCompleteChallengeForCustomer = GamificationRepository.completeChallengeForCustomer;
  const originalDate = global.Date;

  const progressState = {
    progress: 0,
    completed: false,
    completed_at: null,
    last_reset_at: null,
    updated_at: null,
    times_completed: 0,
    last_source_transaction_id: null,
    last_reward_transaction_id: null,
    completion_history: []
  };
  const state = { progressState, updates: [], resets: [], completions: [], transactionInsertCount: 0, locks: 0 };

  const fakeClient = Object.assign(new EventEmitter(), {
    async query(sql, _params) {
      const text = String(sql);
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (text.includes("set_config(")) return { rows: [], rowCount: 0 };
      if (text.includes("SELECT status, reversed_transaction_id")) {
        return { rows: [{ status: "POSTED", reversed_transaction_id: null }], rowCount: 1 };
      }
      if (text.includes("FROM customer_balances WHERE customer_id = $1 FOR UPDATE")) {
        state.locks += 1;
        return { rows: [{ customer_id: "customer-1" }], rowCount: 1 };
      }
      if (text.includes("SELECT c.business_id, b.program_json")) {
        return { rows: [{ business_id: "biz-1", program_json: { region: { country: "GT" } } }], rowCount: 1 };
      }
      if (text.includes("UPDATE customer_balances")) return { rows: [], rowCount: 1 };
      if (text.includes("INSERT INTO transactions")) {
        state.transactionInsertCount += 1;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in recurring challenge test: ${text}`);
    },
    release() {}
  });

  transactionPool.connect = async () => fakeClient;
  GamificationRepository.listActiveChallenges = async () => [challenge];
  GamificationRepository.getCustomerChallengeProgress = async () => ({ ...progressState });
  GamificationRepository.resetRecurringChallengeProgress = async () => {
    state.resets.push({ at: new Date().toISOString() });
    Object.assign(progressState, { progress: 0, completed: false, completed_at: null, last_reset_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return { ...progressState };
  };
  GamificationRepository.updateChallengeProgress = async (_customerId, _challengeId, progress) => {
    state.updates.push(progress);
    Object.assign(progressState, { progress, updated_at: new Date().toISOString() });
    return { ...progressState };
  };
  GamificationRepository.completeChallengeForCustomer = async (_customerId, _challengeId, completion) => {
    state.completions.push(completion);
    Object.assign(progressState, {
      completed: true,
      completed_at: completion.completedAt,
      updated_at: new Date().toISOString(),
      times_completed: progressState.times_completed + 1,
      last_source_transaction_id: completion.sourceTransactionId || null,
      last_reward_transaction_id: completion.rewardTransactionId || null,
      completion_history: [...(progressState.completion_history || []), completion.historyEntry]
    });
    return { ...progressState };
  };

  function setFakeNow(isoString) {
    const fixed = new originalDate(isoString);
    global.Date = /** @type {DateConstructor} */ (class FakeDate extends originalDate {
      constructor(...args) {
        // @ts-ignore -- forwards any Date constructor arguments.
        super(...(args.length ? args : [fixed.getTime()]));
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

  function restore() {
    transactionPool.connect = originalConnect;
    GamificationRepository.listActiveChallenges = originalListActiveChallenges;
    GamificationRepository.getCustomerChallengeProgress = originalGetCustomerChallengeProgress;
    GamificationRepository.resetRecurringChallengeProgress = originalResetRecurringChallengeProgress;
    GamificationRepository.updateChallengeProgress = originalUpdateChallengeProgress;
    GamificationRepository.completeChallengeForCustomer = originalCompleteChallengeForCustomer;
    global.Date = originalDate;
  }

  return { state, setFakeNow, restore };
}

describe("recurring challenge state transitions", () => {
  it("blocks repeat completion in the same window and allows completion after rollover", async () => {
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
    const harness = installRecurringChallengeHarness(challenge);
    const { state, setFakeNow } = harness;
    const progressState = state.progressState;

    try {
      setFakeNow("2026-03-07T10:00:00.000Z");
      const first = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-1" });
      assert.equal(first.length, 1);
      assert.equal(progressState.times_completed, 1);
      assert.equal(state.transactionInsertCount, 1);
      assert.equal(state.completions.length, 1);
      assert.equal(progressState.last_source_transaction_id, "tx-1");
      assert.equal(state.locks, 1, "progress is read under the customer's balance lock");

      setFakeNow("2026-03-07T18:00:00.000Z");
      const second = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-2" });
      assert.equal(second.length, 0);
      assert.equal(progressState.times_completed, 1);
      assert.equal(state.transactionInsertCount, 1);
      assert.equal(state.resets.length, 0);

      setFakeNow("2026-03-08T09:00:00.000Z");
      const third = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-3" });
      assert.equal(third.length, 1);
      assert.equal(progressState.times_completed, 2);
      assert.equal(state.transactionInsertCount, 2);
      assert.equal(state.resets.length, 1);
      assert.equal(state.completions.length, 2);
      assert.equal(progressState.last_source_transaction_id, "tx-3");
      assert.equal(progressState.completion_history.length, 2);
      assert.deepEqual(state.updates, [1, 1]);
    } finally {
      harness.restore();
    }
  });

  it("does not carry unfinished progress into a later week", async () => {
    const challenge = {
      id: "challenge-weekly",
      business_id: "biz-1",
      name: "3 visitas esta semana",
      requirement_type: "visits",
      requirement_value: 3,
      reward_points: 30,
      recurrence: "weekly",
      max_completions: null
    };
    const harness = installRecurringChallengeHarness(challenge);
    const { state, setFakeNow } = harness;

    try {
      // Two visits in the week of Monday 2 Nov (local Guatemala time).
      setFakeNow("2026-11-03T15:00:00.000Z");
      assert.equal((await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-1" })).length, 0);
      setFakeNow("2026-11-05T15:00:00.000Z");
      assert.equal((await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-2" })).length, 0);
      assert.equal(state.progressState.progress, 2);

      // One visit two weeks later starts from zero and does not complete.
      setFakeNow("2026-11-17T15:00:00.000Z");
      const later = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-3" });
      assert.equal(later.length, 0);
      assert.equal(state.progressState.progress, 1);
      assert.equal(state.resets.length, 1);
      assert.equal(state.transactionInsertCount, 0);
      assert.deepEqual(state.updates, [1, 2, 1]);
    } finally {
      harness.restore();
    }
  });

  it("keeps progress within the same local week across the UTC Monday boundary", async () => {
    const challenge = {
      id: "challenge-weekly",
      business_id: "biz-1",
      name: "2 visitas esta semana",
      requirement_type: "visits",
      requirement_value: 2,
      reward_points: 20,
      recurrence: "weekly",
      max_completions: null
    };
    const harness = installRecurringChallengeHarness(challenge);
    const { state, setFakeNow } = harness;

    try {
      // Sunday 15 Nov at 17:00 and 19:00 in Guatemala: the second is Monday in UTC.
      setFakeNow("2026-11-15T23:00:00.000Z");
      await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-1" });
      setFakeNow("2026-11-16T01:00:00.000Z");
      const completed = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-2" });
      assert.equal(completed.length, 1);
      assert.equal(state.resets.length, 0);
    } finally {
      harness.restore();
    }
  });
});

describe("unknown recurrence values", () => {
  it("keep accumulating as before because they have no calendar window", async () => {
    const harness = installRecurringChallengeHarness({
      id: "challenge-custom",
      business_id: "biz-1",
      name: "Legacy recurrence",
      requirement_type: "visits",
      requirement_value: 2,
      reward_points: 10,
      recurrence: "custom",
      max_completions: null
    });
    try {
      harness.setFakeNow("2026-11-02T15:00:00.000Z");
      await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-1" });
      harness.setFakeNow("2026-11-20T15:00:00.000Z");
      const completed = await updateChallengeProgress("customer-1", "visits", 1, { sourceTransactionId: "tx-2" });
      assert.equal(completed.length, 1);
      assert.equal(harness.state.resets.length, 0);
    } finally {
      harness.restore();
    }
  });
});

describe("achievement awards", () => {
  it("credits points only when the achievement insert recorded a new row", async () => {
    const originalConnect = transactionPool.connect;
    const originalListAchievements = GamificationRepository.listAchievements;
    const originalCheckAchievementEarned = GamificationRepository.checkAchievementEarned;
    const originalAwardAchievement = GamificationRepository.awardAchievement;
    const seen = [];
    const fakeClient = Object.assign(new EventEmitter(), {
      async query(sql) {
        const text = String(sql);
        seen.push(text);
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK" || text.includes("set_config(")) return { rows: [], rowCount: 0 };
        if (text.includes("FROM customer_balances WHERE customer_id = $1 FOR UPDATE")) return { rows: [{ customer_id: "customer-1" }], rowCount: 1 };
        if (text.includes("FROM customers c")) {
          return { rows: [{ business_id: "biz-1", points: 50, lifetime_points: 1200, longest_streak: 0 }], rowCount: 1 };
        }
        if (text.includes("UPDATE customer_balances") || text.includes("INSERT INTO transactions") || text.includes("UPDATE customer_achievements")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL in achievement award test: ${text}`);
      },
      release() {}
    });
    transactionPool.connect = async () => fakeClient;
    GamificationRepository.listAchievements = async () => [
      { id: "ach-1", active: true, name: "Points Collector", requirement_type: "points", requirement_value: 1000, points_reward: 100 }
    ];
    GamificationRepository.checkAchievementEarned = async () => null;
    try {
      // A concurrent transaction already inserted the row: nothing is credited.
      GamificationRepository.awardAchievement = async () => undefined;
      assert.deepEqual(await checkAndAwardAchievements("customer-1"), []);
      assert.equal(seen.some(text => text.includes("UPDATE customer_balances") || text.includes("INSERT INTO transactions")), false);

      seen.length = 0;
      GamificationRepository.awardAchievement = async () => ({ id: "row-1" });
      const earned = await checkAndAwardAchievements("customer-1");
      assert.equal(earned.length, 1);
      const lockIndex = seen.findIndex(text => text.includes("FOR UPDATE"));
      const creditIndex = seen.findIndex(text => text.includes("UPDATE customer_balances"));
      assert.ok(lockIndex >= 0 && lockIndex < creditIndex, "the customer is locked before anything is credited");
      assert.ok(seen.some(text => text.includes("SET reward_transaction_id")), "the reward is linked to the earned row");
    } finally {
      transactionPool.connect = originalConnect;
      GamificationRepository.listAchievements = originalListAchievements;
      GamificationRepository.checkAchievementEarned = originalCheckAchievementEarned;
      GamificationRepository.awardAchievement = originalAwardAchievement;
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
