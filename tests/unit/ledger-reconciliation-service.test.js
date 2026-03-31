import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  expectedLedgerBalances,
  isLedgerBalanceMismatch,
  buildLedgerFinding
} = await import("../../src/app/services/ledger-reconciliation-service.js");

describe("ledger reconciliation helpers", () => {
  it("derives cached balances from posted and pending ledger rows", () => {
    const expected = expectedLedgerBalances({
      expected_points: "120",
      expected_pending_points: "15",
      expected_lifetime_points: "240"
    });

    assert.deepEqual(expected, {
      points: 120,
      pending_points: 15,
      lifetime_points: 240
    });
  });

  it("detects mismatches when lifetime points drift from the ledger", () => {
    assert.equal(isLedgerBalanceMismatch({
      stored_points: 120,
      stored_pending_points: 15,
      stored_lifetime_points: 180,
      expected_points: 120,
      expected_pending_points: 15,
      expected_lifetime_points: 240
    }), true);
  });

  it("builds reconciliation findings with explicit deltas", () => {
    const finding = buildLedgerFinding({
      customer_id: "cust-1",
      business_id: "biz-1",
      stored_points: 90,
      stored_pending_points: 5,
      stored_lifetime_points: 100,
      expected_points: 120,
      expected_pending_points: 0,
      expected_lifetime_points: 240
    });

    assert.deepEqual(finding, {
      customer_id: "cust-1",
      business_id: "biz-1",
      stored_points: 90,
      expected_points: 120,
      stored_pending_points: 5,
      expected_pending_points: 0,
      stored_lifetime_points: 100,
      expected_lifetime_points: 240,
      delta_points: 30,
      delta_pending_points: -5,
      delta_lifetime_points: 140
    });
  });

  it("handles mixed earn, pending, redeem, refund, expire, and reward sequences", () => {
    const expected = expectedLedgerBalances({
      expected_points: String(
        100 + 40 + 25 + 20 - 30 - 15 - 10
      ),
      expected_pending_points: String(12),
      expected_lifetime_points: String(
        100 + 40 + 25 + 20
      )
    });

    assert.deepEqual(expected, {
      points: 130,
      pending_points: 12,
      lifetime_points: 185
    });
  });
});
