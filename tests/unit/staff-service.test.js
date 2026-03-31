import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

let computePointsValue = 0;
let verifyQrTokenValue = null;
let capturedInsertParams = null;
let challengeProgressCalls = null;
let webhookCalls = null;

const fakeClient = {
  query: async (sql, params) => {
    if (sql.includes("FROM transactions")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT id FROM customers")) return { rows: [{ id: "c1" }], rowCount: 1 };
    if (sql.includes("INSERT INTO qr_tokens")) return { rows: [{ jti: "j1" }], rowCount: 1 };
    if (sql.includes("INSERT INTO transactions")) {
      capturedInsertParams = params;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE customer_balances")) return { rows: [{ points: 123, pending_points: 0 }], rowCount: 1 };
    if (sql.includes("UPDATE customers SET last_visit_at")) return { rows: [], rowCount: 1 };
    if (sql.includes("SELECT points FROM customer_balances")) return { rows: [{ points: 10 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
};

const { awardPointsWithDeps, redeemRewardWithDeps } = await import("../../src/app/services/staff-service.js");

describe("awardPoints", () => {
  beforeEach(() => {
    computePointsValue = 0;
    verifyQrTokenValue = { bid: "b1", cid: "c1", jti: "j1", exp: 999999 };
    capturedInsertParams = null;
    challengeProgressCalls = [];
    webhookCalls = [];
  });

  it("writes transaction with correct parameters", async () => {
    computePointsValue = 42;

    const result = await awardPointsWithDeps(
      {
        verifyQrToken: async () => verifyQrTokenValue,
        BusinessRepo: {
          getById: async () => ({ id: "b1", plan: "EMPRENDEDOR", program_type: "SPEND", program_json: {} }),
          activeCustomerCount: async () => 0
        },
        computePoints: () => computePointsValue,
        planLimits: () => ({ activeCustomers: 9999 }),
        withTransaction: async (fn) => fn(fakeClient),
        enqueueWebhookEvent: async (...args) => { webhookCalls.push(args); },
        loadTierService: async () => ({ TierService: { checkTierProgression: async () => {} } }),
        loadGamificationService: async () => ({
          GamificationService: {
            checkAndAwardAchievements: async () => [],
            updateChallengeProgress: async (...args) => {
              challengeProgressCalls.push(args);
            }
          }
        }),
        isSourceTransactionActive: async () => true,
        loadReferralService: async () => ({ ReferralService: { checkAndCompleteReferral: async () => {} } })
      },
      {
      staff: { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" },
      customerQrToken: "token",
      amount_q: 100,
      visits: 2,
      items: 3,
      meta: { note: "test" },
      txId: "tx-1"
      }
    );

    assert.equal(result.pointsAwarded, 42);
    assert.ok(Array.isArray(capturedInsertParams), "transaction insert params captured");
    assert.equal(capturedInsertParams.length, 13, "transaction insert param count");
    assert.deepEqual(
      capturedInsertParams,
      ["tx-1", "b1", null, "c1", "s1", 100, 2, 3, 42, "POSTED", null, "online", { note: "test" }]
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("uses numeric item count for challenge progress", async () => {
    computePointsValue = 1;

    await awardPointsWithDeps(
      {
        verifyQrToken: async () => verifyQrTokenValue,
        BusinessRepo: {
          getById: async () => ({ id: "b1", plan: "EMPRENDEDOR", program_type: "SPEND", program_json: {} }),
          activeCustomerCount: async () => 0
        },
        computePoints: () => computePointsValue,
        planLimits: () => ({ activeCustomers: 9999 }),
        withTransaction: async (fn) => fn(fakeClient),
        enqueueWebhookEvent: async (...args) => { webhookCalls.push(args); },
        loadTierService: async () => ({ TierService: { checkTierProgression: async () => {} } }),
        loadGamificationService: async () => ({
          GamificationService: {
            checkAndAwardAchievements: async () => [],
            updateChallengeProgress: async (...args) => {
              challengeProgressCalls.push(args);
            }
          }
        }),
        isSourceTransactionActive: async () => true,
        loadReferralService: async () => ({ ReferralService: { checkAndCompleteReferral: async () => {} } })
      },
      {
      staff: { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" },
      customerQrToken: "token",
      items: 2
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(challengeProgressCalls.length > 0, "challenge progress updated");
    const itemCall = challengeProgressCalls.find((args) => args[1] === "items");
    assert.ok(itemCall, "item challenge progress recorded");
    assert.equal(itemCall[2], 2);
    assert.equal(typeof itemCall[3]?.sourceTransactionId, "string");
  });

  it("uses purchase amount for spend challenge progress", async () => {
    computePointsValue = 1;

    await awardPointsWithDeps(
      {
        verifyQrToken: async () => verifyQrTokenValue,
        BusinessRepo: {
          getById: async () => ({ id: "b1", plan: "EMPRENDEDOR", program_type: "SPEND", program_json: {} }),
          activeCustomerCount: async () => 0
        },
        computePoints: () => computePointsValue,
        planLimits: () => ({ activeCustomers: 9999 }),
        withTransaction: async (fn) => fn(fakeClient),
        enqueueWebhookEvent: async (...args) => { webhookCalls.push(args); },
        loadTierService: async () => ({ TierService: { checkTierProgression: async () => {} } }),
        loadGamificationService: async () => ({
          GamificationService: {
            checkAndAwardAchievements: async () => [],
            updateChallengeProgress: async (...args) => {
              challengeProgressCalls.push(args);
            }
          }
        }),
        isSourceTransactionActive: async () => true,
        loadReferralService: async () => ({ ReferralService: { checkAndCompleteReferral: async () => {} } })
      },
      {
        staff: { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" },
        customerQrToken: "token",
        amount_q: 37.5
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const spendCall = challengeProgressCalls.find((args) => args[1] === "spend");
    assert.ok(spendCall, "spend challenge progress recorded");
    assert.equal(spendCall[2], 37.5);
  });

  it("returns the existing transaction when the same txId is replayed", async () => {
    computePointsValue = 11;

    const replayClient = {
      query: async (sql) => {
        if (sql.includes("pg_advisory_xact_lock")) {
          return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
        }
        if (sql.includes("FROM transactions")) {
          return {
            rows: [{ id: "tx-replay", business_id: "b1", customer_id: "c1", points: 11 }],
            rowCount: 1
          };
        }
        if (sql.includes("SELECT points FROM customer_balances")) {
          return { rows: [{ points: 88 }], rowCount: 1 };
        }
        throw new Error(`Unexpected query in replay test: ${sql}`);
      }
    };

    const result = await awardPointsWithDeps(
      {
        verifyQrToken: async () => verifyQrTokenValue,
        BusinessRepo: {
          getById: async () => ({ id: "b1", plan: "EMPRENDEDOR", program_type: "SPEND", program_json: {} }),
          activeCustomerCount: async () => 0
        },
        computePoints: () => computePointsValue,
        planLimits: () => ({ activeCustomers: 9999 }),
        withTransaction: async (fn) => fn(replayClient),
        enqueueWebhookEvent: async (...args) => { webhookCalls.push(args); },
        loadTierService: async () => ({ TierService: { checkTierProgression: async () => {} } }),
        loadGamificationService: async () => ({
          GamificationService: {
            checkAndAwardAchievements: async () => [],
            updateChallengeProgress: async (...args) => {
              challengeProgressCalls.push(args);
            }
          }
        }),
        isSourceTransactionActive: async () => true,
        loadReferralService: async () => ({ ReferralService: { checkAndCompleteReferral: async () => {} } })
      },
      {
        staff: { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" },
        customerQrToken: "token",
        amount_q: 10,
        txId: "tx-replay"
      }
    );

    assert.equal(result.transactionId, "tx-replay");
    assert.equal(result.pointsAwarded, 11);
    assert.equal(result.newBalance, 88);
    assert.equal(webhookCalls.length, 0);
    assert.equal(challengeProgressCalls.length, 0);
  });

  it("uses awarded points for points challenge progress", async () => {
    computePointsValue = 18;

    await awardPointsWithDeps(
      {
        verifyQrToken: async () => verifyQrTokenValue,
        BusinessRepo: {
          getById: async () => ({ id: "b1", plan: "EMPRENDEDOR", program_type: "SPEND", program_json: {} }),
          activeCustomerCount: async () => 0
        },
        computePoints: () => computePointsValue,
        planLimits: () => ({ activeCustomers: 9999 }),
        withTransaction: async (fn) => fn(fakeClient),
        enqueueWebhookEvent: async (...args) => { webhookCalls.push(args); },
        loadTierService: async () => ({ TierService: { checkTierProgression: async () => {} } }),
        loadGamificationService: async () => ({
          GamificationService: {
            checkAndAwardAchievements: async () => [],
            updateChallengeProgress: async (...args) => {
              challengeProgressCalls.push(args);
            }
          }
        }),
        isSourceTransactionActive: async () => true,
        loadReferralService: async () => ({ ReferralService: { checkAndCompleteReferral: async () => {} } })
      },
      {
        staff: { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" },
        customerQrToken: "token",
        amount_q: 50
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const pointsCall = challengeProgressCalls.find((args) => args[1] === "points");
    assert.ok(pointsCall, "points challenge progress recorded");
    assert.equal(pointsCall[2], 18);
  });
});

describe("redeemReward", () => {
  beforeEach(() => {
    webhookCalls = [];
  });

  it("returns the existing redemption when the same requestId is replayed", async () => {
    let advisoryLockCount = 0;
    const out = await redeemRewardWithDeps(
      {
        BusinessRepo: {
          getById: async () => ({ id: "b1", program_json: {} })
        },
        RewardRepo: {
          listBranchIds: async () => []
        },
        withTransaction: async (fn) => fn({
          query: async (sql) => {
            if (sql.includes("pg_advisory_xact_lock")) {
              advisoryLockCount += 1;
              return { rows: [], rowCount: 1 };
            }
            if (sql.includes("FROM redemptions r") && sql.includes("request_id = $2")) {
              return {
                rows: [{
                  id: "red-1",
                  business_id: "b1",
                  customer_id: "c1",
                  reward_id: "reward-1",
                  code: "ABC12345",
                  points_cost: 25,
                  balance_after: 75,
                  reward_name: "Cafe"
                }],
                rowCount: 1
              };
            }
            throw new Error(`Unexpected query in redeem replay test: ${sql}`);
          }
        }),
        settlePendingPointsForCustomer: async () => {},
        expirePointsForCustomer: async () => {},
        enqueueWebhookEvent: async (...args) => {
          webhookCalls.push(args);
        }
      },
      {
        staff: { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" },
        customerId: "c1",
        rewardId: "reward-1",
        requestId: "11111111-1111-4111-8111-111111111111"
      }
    );

    assert.deepEqual(out, {
      redemptionCode: "ABC12345",
      rewardName: "Cafe",
      newBalance: 75
    });
    assert.equal(advisoryLockCount, 1);
    assert.equal(webhookCalls.length, 0);
  });
});
