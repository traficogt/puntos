import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

let computePointsValue = 0;
let verifyQrTokenValue = null;
let capturedInsertParams = null;
let itemsProgressArgs = null;

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

const { awardPointsWithDeps } = await import("../../src/app/services/staff-service.js");

describe("awardPoints", () => {
  beforeEach(() => {
    computePointsValue = 0;
    verifyQrTokenValue = { bid: "b1", cid: "c1", jti: "j1", exp: 999999 };
    capturedInsertParams = null;
    itemsProgressArgs = null;
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
        enqueueWebhookEvent: async () => {},
        loadTierService: async () => ({ TierService: { checkTierProgression: async () => {} } }),
        loadGamificationService: async () => ({
          GamificationService: {
            checkAndAwardAchievements: async () => [],
            updateChallengeProgress: async (...args) => {
              itemsProgressArgs = args;
            }
          }
        }),
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
        enqueueWebhookEvent: async () => {},
        loadTierService: async () => ({ TierService: { checkTierProgression: async () => {} } }),
        loadGamificationService: async () => ({
          GamificationService: {
            checkAndAwardAchievements: async () => [],
            updateChallengeProgress: async (...args) => {
              itemsProgressArgs = args;
            }
          }
        }),
        loadReferralService: async () => ({ ReferralService: { checkAndCompleteReferral: async () => {} } })
      },
      {
      staff: { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" },
      customerQrToken: "token",
      items: 2
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(itemsProgressArgs, "challenge progress updated");
    assert.equal(itemsProgressArgs[1], "items");
    assert.equal(itemsProgressArgs[2], 2);
  });
});
