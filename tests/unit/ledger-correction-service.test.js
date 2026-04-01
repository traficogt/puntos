import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyLedgerCorrectionWithDeps,
  rejectLedgerCorrectionWithDeps,
  requestLedgerCorrectionWithDeps
} from "../../src/app/services/ledger-correction-service.js";

/**
 * @param {{ client?: { query: (...args: any[]) => Promise<any>, adjusted?: boolean }, row?: any, correction?: any }} [options]
 */
function makeDeps({ client, row, correction } = {}) {
  return {
    withTransaction: async (fn) => fn(client),
    AuditRepo: { log: async () => {} },
    readCustomerLedgerRow: async () => row,
    applyBalanceAdjustment: async () => {
      client.adjusted = true;
      return "adj-1";
    },
    correction
  };
}

describe("ledger correction service", () => {
  it("creates a pending correction request from a live mismatch", async () => {
    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push([String(sql), params]);
        return { rows: [], rowCount: 1 };
      }
    };
    const deps = makeDeps({
      client,
      row: {
        customer_id: "cust-1",
        business_id: "biz-1",
        stored_points: 10,
        expected_points: 25,
        stored_pending_points: 0,
        expected_pending_points: 0,
        stored_lifetime_points: 10,
        expected_lifetime_points: 25
      }
    });

    const out = await requestLedgerCorrectionWithDeps(deps, {
      businessId: "biz-1",
      customerId: "cust-1",
      requestedByStaffId: "owner-1",
      reason: "Balance drift verified against transaction ledger"
    });

    assert.equal(out.ok, true);
    assert.equal(out.correction.status, "PENDING");
    assert.equal(out.correction.delta_points, 15);
    assert.ok(calls.some(([sql]) => sql.includes("INSERT INTO ledger_balance_corrections")));
  });

  it("requires a second owner to apply a correction", async () => {
    const client = {
      adjusted: false,
      query: async (sql) => {
        if (String(sql).includes("FROM ledger_balance_corrections")) {
          return {
            rows: [{
              id: "corr-1",
              business_id: "biz-1",
              customer_id: "cust-1",
              status: "PENDING",
              requested_by_staff_id: "owner-1"
            }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 1 };
      }
    };
    const deps = makeDeps({
      client,
      row: {
        customer_id: "cust-1",
        business_id: "biz-1",
        stored_points: 10,
        expected_points: 25,
        stored_pending_points: 0,
        expected_pending_points: 0,
        stored_lifetime_points: 10,
        expected_lifetime_points: 25
      }
    });

    await assert.rejects(
      applyLedgerCorrectionWithDeps(deps, {
        businessId: "biz-1",
        correctionId: "corr-1",
        resolvedByStaffId: "owner-1"
      }),
      /different owner/i
    );
    assert.equal(client.adjusted, false);

    const out = await applyLedgerCorrectionWithDeps(deps, {
      businessId: "biz-1",
      correctionId: "corr-1",
      resolvedByStaffId: "owner-2"
    });
    assert.equal(out.ok, true);
    assert.equal(out.correction.status, "APPLIED");
    assert.equal(out.correction.adjustment_id, "adj-1");
    assert.equal(client.adjusted, true);
  });

  it("rejects a correction with a second owner and keeps the ledger untouched", async () => {
    let updates = 0;
    const client = {
      query: async (sql) => {
        const text = String(sql);
        if (text.includes("FROM ledger_balance_corrections")) {
          return {
            rows: [{
              id: "corr-2",
              business_id: "biz-1",
              customer_id: "cust-9",
              status: "PENDING",
              requested_by_staff_id: "owner-1"
            }],
            rowCount: 1
          };
        }
        if (text.includes("UPDATE ledger_balance_corrections")) {
          updates += 1;
        }
        return { rows: [], rowCount: 1 };
      }
    };
    const deps = makeDeps({ client, row: null });

    const out = await rejectLedgerCorrectionWithDeps(deps, {
      businessId: "biz-1",
      correctionId: "corr-2",
      resolvedByStaffId: "owner-2",
      reason: "Reviewed and determined no manual correction should be applied"
    });

    assert.equal(out.ok, true);
    assert.equal(out.correction.status, "REJECTED");
    assert.equal(updates, 1);
  });
});
