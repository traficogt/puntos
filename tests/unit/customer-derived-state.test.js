import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  calculateVisitStreakMetrics,
  computePurchaseFrequencyPerMonth,
  refreshCustomerDerivedState,
} = await import("../../src/app/services/customer-derived-state.js");

describe("customer derived state helpers", () => {
  it("calculates purchase frequency across active months", () => {
    const frequency = computePurchaseFrequencyPerMonth(
      6,
      "2026-01-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    );
    assert.ok(frequency > 2.9 && frequency < 3.1);
  });

  it("builds current and longest streaks from distinct visit dates", () => {
    const streak = calculateVisitStreakMetrics([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-06",
      "2026-03-07",
    ]);
    assert.deepEqual(streak, {
      currentStreak: 2,
      longestStreak: 3,
      lastVisitDate: "2026-03-07",
      streakStartedAt: "2026-03-06",
    });
  });

  it("returns empty streak metrics when there are no visits", () => {
    assert.deepEqual(calculateVisitStreakMetrics([]), {
      currentStreak: 0,
      longestStreak: 0,
      lastVisitDate: null,
      streakStartedAt: null,
    });
  });

  it("projects the two-year LTV from the NUMERIC average ticket in exact centavos", async () => {
    const writes = [];
    const client = {
      async query(sql, params) {
        const text = String(sql);
        if (text.includes("AVG(amount_q)")) {
          return {
            rows: [
              {
                total_spend: "59.97",
                total_visits: 3,
                total_transactions: 3,
                avg_transaction_value: "19.99",
                first_purchase_at: "2026-01-01T00:00:00.000Z",
                last_purchase_at: "2026-03-02T00:00:00.000Z", // 60 days -> 2 months
                days_since_last_purchase: 4,
              },
            ],
          };
        }
        if (text.includes("INSERT INTO customer_ltv")) {
          writes.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    await refreshCustomerDerivedState(client, "cust-1");
    assert.equal(writes.length, 1);
    const [, , , , avg, , , , frequency, predictedLtv] = writes[0];
    assert.equal(avg, "19.99");
    assert.equal(frequency, 1.5);
    // 19.99 * 1.5 purchases/month * 24 months = 719.64, with no float residue.
    assert.equal(predictedLtv, 719.64);
  });
});
