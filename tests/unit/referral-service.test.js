import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  completeAndRewardReferralWithDeps,
  applyReferralCodeWithDeps
} = await import("../../src/app/services/referral-service.js");

function makeReferralClient(initialStatus = "pending") {
  const state = {
    referral: {
      id: "ref-1",
      business_id: "b1",
      referrer_customer_id: "referrer-1",
      referred_customer_id: "referred-1",
      status: initialStatus
    },
    balanceUpdates: [],
    rewardLogs: [],
    seenSql: []
  };

  return {
    state,
    client: {
      query: async (sql, params) => {
        state.seenSql.push(sql);

        if (sql.includes("FROM referrals WHERE id = $1 FOR UPDATE")) {
          return { rows: [state.referral], rowCount: 1 };
        }
        if (sql.includes("FROM referral_settings")) {
          return {
            rows: [{
              business_id: "b1",
              referrer_reward_points: 100,
              referred_reward_points: 50
            }],
            rowCount: 1
          };
        }
        if (sql.includes("UPDATE referrals") && sql.includes("AND status = 'pending'")) {
          if (state.referral.status !== "pending") {
            return { rows: [], rowCount: 0 };
          }
          state.referral = {
            ...state.referral,
            status: "completed",
            referrer_reward_points: 100,
            referred_reward_points: 50
          };
          return { rows: [state.referral], rowCount: 1 };
        }
        if (sql.includes("UPDATE customer_balances")) {
          state.balanceUpdates.push(params);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO transactions")) {
          state.rewardLogs.push(params);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SET status = 'rewarded'")) {
          state.referral = {
            ...state.referral,
            status: "rewarded",
            referrer_rewarded_at: "now",
            referred_rewarded_at: "now"
          };
          return { rows: [state.referral], rowCount: 1 };
        }
        if (sql.trim() === "SELECT * FROM referrals WHERE id = $1") {
          return { rows: [state.referral], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL in referral test: ${sql}`);
      }
    }
  };
}

describe("completeAndRewardReferral", () => {
  /** @type {{ client: { query: Function }, state: Record<string, unknown> }} */
  let harness;

  beforeEach(() => {
    harness = makeReferralClient();
  });

  it("locks the referral row and rewards it only once", async () => {
    const out = await completeAndRewardReferralWithDeps(
      {
        withTransaction: async (fn) => fn(harness.client)
      },
      "ref-1"
    );

    assert.equal(out.status, "rewarded");
    assert.equal(harness.state.balanceUpdates.length, 2);
    assert.equal(harness.state.rewardLogs.length, 2);
    assert.ok(
      harness.state.seenSql.some((sql) => sql.includes("FROM referrals WHERE id = $1 FOR UPDATE")),
      "referral row locked before status check"
    );
  });

  it("returns early without side effects when the referral is already rewarded", async () => {
    harness = makeReferralClient("rewarded");

    const out = await completeAndRewardReferralWithDeps(
      {
        withTransaction: async (fn) => fn(harness.client)
      },
      "ref-1"
    );

    assert.equal(out.status, "rewarded");
    assert.equal(harness.state.balanceUpdates.length, 0);
    assert.equal(harness.state.rewardLogs.length, 0);
  });
});

describe("applyReferralCode", () => {
  it("locks the referral code and increments uses_count inside the write transaction", async () => {
    const seenSql = [];
    const out = await applyReferralCodeWithDeps(
      {
        withTransaction: async (fn) => fn({
          query: async (sql, params) => {
            seenSql.push(sql);
            if (sql.includes("FROM referral_codes") && sql.includes("FOR UPDATE")) {
              return {
                rows: [{
                  id: "code-1",
                  business_id: "b1",
                  referrer_customer_id: "referrer-1",
                  code: "ABC123",
                  uses_count: 0,
                  max_uses: 3,
                  active: true
                }],
                rowCount: 1
              };
            }
            if (sql.includes("FROM referrals") && sql.includes("referred_customer_id")) {
              return { rows: [], rowCount: 0 };
            }
            if (sql.includes("UPDATE referral_codes") && sql.includes("uses_count = uses_count + 1")) {
              return { rows: [{ id: "code-1", uses_count: 1 }], rowCount: 1 };
            }
            if (sql.includes("INSERT INTO referrals")) {
              return {
                rows: [{
                  id: "ref-2",
                  business_id: "b1",
                  referral_code_id: "code-1",
                  referrer_customer_id: "referrer-1",
                  referred_customer_id: "cust-2",
                  status: "pending"
                }],
                rowCount: 1
              };
            }
            if (sql.includes("FROM referral_settings")) {
              return { rows: [{ reward_on_signup: false }], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in applyReferralCode test: ${sql} :: ${params}`);
          }
        })
      },
      "ABC123",
      "cust-2",
      "b1"
    );

    assert.equal(out.id, "ref-2");
    assert.ok(seenSql.some((sql) => sql.includes("FROM referral_codes") && sql.includes("FOR UPDATE")));
    assert.ok(seenSql.some((sql) => sql.includes("UPDATE referral_codes") && sql.includes("uses_count = uses_count + 1")));
  });

  it("returns a controlled business error when the customer is already referred", async () => {
    await assert.rejects(
      () => applyReferralCodeWithDeps(
        {
          withTransaction: async (fn) => fn({
            query: async (sql) => {
              if (sql.includes("FROM referral_codes") && sql.includes("FOR UPDATE")) {
                return {
                  rows: [{
                    id: "code-1",
                    business_id: "b1",
                    referrer_customer_id: "referrer-1",
                    code: "ABC123",
                    uses_count: 0,
                    max_uses: 3,
                    active: true
                  }],
                  rowCount: 1
                };
              }
              if (sql.includes("FROM referrals") && sql.includes("referred_customer_id")) {
                return { rows: [{ id: "existing" }], rowCount: 1 };
              }
              throw new Error(`Unexpected SQL in duplicate referral test: ${sql}`);
            }
          })
        },
        "ABC123",
        "cust-2",
        "b1"
      ),
      /already been referred/i
    );
  });
});
