import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  completeAndRewardReferralWithDeps,
  applyReferralCodeWithDeps
} = await import("../../src/app/services/referral-service.js");

const deps = (client, overrides = {}) => ({
  withTransaction: async (fn) => fn(client),
  getPlanFeatureOverrides: async () => overrides
});

function makeReferralClient(initialStatus = "pending", {
  enabled = true,
  plan = "NEGOCIO",
  minPurchase = null,
  purchases = { total_spend: "0", purchases: 1 }
} = {}) {
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
    seenSql: [],
    /** @type {string | undefined} */
    purchaseSql: undefined
  };

  return {
    state,
    client: {
      query: async (sql, params) => {
        state.seenSql.push(sql);

        if (sql.includes("SELECT referred_customer_id FROM referrals WHERE id = $1")) {
          return { rows: [{ referred_customer_id: state.referral.referred_customer_id }], rowCount: 1 };
        }
        if (sql.includes("FROM customer_balances WHERE customer_id = $1 FOR UPDATE")) {
          return { rows: [{ customer_id: params[0] }], rowCount: 1 };
        }
        if (sql.includes("FROM referrals WHERE id = $1 FOR UPDATE")) {
          return { rows: [state.referral], rowCount: 1 };
        }
        if (sql.includes("FROM referral_settings")) {
          return {
            rows: [{
              business_id: "b1",
              enabled,
              referrer_reward_points: 100,
              referred_reward_points: 50,
              min_purchase_to_complete: minPurchase
            }],
            rowCount: 1
          };
        }
        if (sql.includes("SELECT plan FROM businesses")) {
          return { rows: [{ plan }], rowCount: 1 };
        }
        if (sql.includes("COUNT(*)::int AS purchases")) {
          state.purchaseSql = sql;
          return { rows: [purchases], rowCount: 1 };
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
  /** @type {{ client: { query: Function }, state: { balanceUpdates: any[], rewardLogs: any[], seenSql: string[], purchaseSql?: string } }} */
  let harness;

  beforeEach(() => {
    harness = makeReferralClient();
  });

  it("locks the referral row and rewards it only once", async () => {
    const out = await completeAndRewardReferralWithDeps(deps(harness.client), "ref-1");

    assert.equal(out.status, "rewarded");
    assert.equal(harness.state.balanceUpdates.length, 2);
    assert.equal(harness.state.rewardLogs.length, 2);
    assert.ok(
      harness.state.seenSql.some((sql) => sql.includes("FROM referrals WHERE id = $1 FOR UPDATE")),
      "referral row locked before status check"
    );
    const balanceLock = harness.state.seenSql.findIndex((sql) => sql.includes("FROM customer_balances WHERE customer_id = $1 FOR UPDATE"));
    const referralLock = harness.state.seenSql.findIndex((sql) => sql.includes("FROM referrals WHERE id = $1 FOR UPDATE"));
    assert.ok(balanceLock >= 0 && balanceLock < referralLock, "referred customer locked before the referral, as refunds do");
    const meta = JSON.parse(harness.state.rewardLogs[0][3]);
    assert.equal(meta.referral_id, "ref-1");
    assert.equal(meta.trigger, "purchase");
  });

  it("returns early without side effects when the referral is already rewarded", async () => {
    harness = makeReferralClient("rewarded");

    const out = await completeAndRewardReferralWithDeps(deps(harness.client), "ref-1");

    assert.equal(out.status, "rewarded");
    assert.equal(harness.state.balanceUpdates.length, 0);
    assert.equal(harness.state.rewardLogs.length, 0);
  });

  it("pays nothing after the owner disables the program", async () => {
    harness = makeReferralClient("pending", { enabled: false });
    const out = await completeAndRewardReferralWithDeps(deps(harness.client), "ref-1");
    assert.equal(out.status, "pending");
    assert.equal(harness.state.balanceUpdates.length, 0);
    assert.equal(harness.state.rewardLogs.length, 0);
  });

  it("pays nothing when the plan no longer includes referrals", async () => {
    harness = makeReferralClient("pending", { plan: "EMPRENDEDOR" });
    const out = await completeAndRewardReferralWithDeps(deps(harness.client), "ref-1");
    assert.equal(out.status, "pending");
    assert.equal(harness.state.balanceUpdates.length, 0);
  });

  it("measures the minimum with settled purchases only and records it with the reward", async () => {
    harness = makeReferralClient("pending", { minPurchase: "100.00", purchases: { total_spend: "60.00", purchases: 2 } });
    const pending = await completeAndRewardReferralWithDeps(deps(harness.client), "ref-1");
    assert.equal(pending.status, "pending");
    assert.equal(harness.state.balanceUpdates.length, 0);
    assert.match(harness.state.purchaseSql, /reversed_transaction_id IS NULL/);
    assert.match(harness.state.purchaseSql, /status <> 'PENDING'/);
    assert.match(harness.state.purchaseSql, /source IN \('online', 'offline', 'external', 'order'\)/);

    harness = makeReferralClient("pending", { minPurchase: "100.00", purchases: { total_spend: "120.00", purchases: 2 } });
    const rewarded = await completeAndRewardReferralWithDeps(deps(harness.client), "ref-1");
    assert.equal(rewarded.status, "rewarded");
    assert.equal(JSON.parse(harness.state.rewardLogs[0][3]).min_purchase_to_complete, "100.00");
  });

  it("does not require a purchase when rewarding on signup", async () => {
    harness = makeReferralClient("pending", { purchases: { total_spend: "0", purchases: 0 } });
    const out = await completeAndRewardReferralWithDeps(deps(harness.client), "ref-1", { trigger: "signup" });
    assert.equal(out.status, "rewarded");
    assert.equal(JSON.parse(harness.state.rewardLogs[1][3]).trigger, "signup");
    assert.equal(harness.state.purchaseSql, undefined);
  });
});

describe("applyReferralCode", () => {
  it("locks the referral code and increments uses_count inside the write transaction", async () => {
    const seenSql = [];
    const out = await applyReferralCodeWithDeps(
      {
        getPlanFeatureOverrides: async () => ({}),
        withTransaction: async (fn) => fn({
          query: async (sql, params) => {
            seenSql.push(sql);
            if (sql.includes("FROM referral_settings")) {
              return { rows: [{ enabled: true, reward_on_signup: false }], rowCount: 1 };
            }
            if (sql.includes("SELECT plan FROM businesses")) {
              return { rows: [{ plan: "NEGOCIO" }], rowCount: 1 };
            }
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
          getPlanFeatureOverrides: async () => ({}),
          withTransaction: async (fn) => fn({
            query: async (sql) => {
              if (sql.includes("FROM referral_settings")) {
                return { rows: [{ enabled: true, reward_on_signup: false }], rowCount: 1 };
              }
              if (sql.includes("SELECT plan FROM businesses")) {
                return { rows: [{ plan: "NEGOCIO" }], rowCount: 1 };
              }
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

  it("rejects a code while the owner has the program disabled, before using the code", async () => {
    const seenSql = [];
    await assert.rejects(
      () => applyReferralCodeWithDeps(
        {
          getPlanFeatureOverrides: async () => ({}),
          withTransaction: async (fn) => fn({
            query: async (sql) => {
              seenSql.push(sql);
              if (sql.includes("FROM referral_settings")) return { rows: [{ enabled: false }], rowCount: 1 };
              throw new Error(`Unexpected SQL in disabled referral test: ${sql}`);
            }
          })
        },
        "ABC123",
        "cust-2",
        "b1"
      ),
      { statusCode: 403 }
    );
    assert.equal(seenSql.some((sql) => sql.includes("referral_codes")), false);
  });
});
