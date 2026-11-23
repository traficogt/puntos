import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { before, beforeEach, describe, it } from "node:test";

const businessId = randomUUID(),
  branchId = randomUUID();
const now = new Date("2026-11-16T12:00:00Z");
let getFirstPurchaseReturns, queries, business;
before(async () => {
  const service = new URL(
    "../../src/app/services/first-purchase-return-service.js",
    import.meta.url,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository module URL.
  assert.ok(existsSync(service), "First purchase return report service must exist");
  ({ getFirstPurchaseReturns } = await import(service.href));
});
beforeEach(() => {
  queries = [];
  business = { program_json: {} };
});
async function query(sql, params) {
  queries.push({ sql, params });
  if (sql.includes("FROM businesses")) return { rows: business ? [business] : [] };
  if (sql.includes("FROM branches"))
    return { rows: params[0] === branchId ? [{ id: branchId }] : [] };
  return {
    rows: [
      {
        start_at: "2026-11-09T06:00:00Z",
        end_at: "2026-11-16T06:00:00Z",
        customers: "0",
        legacy_timestamp_customers: "0",
        completed: {
          customers: 0,
          returned_customers: 0,
          without_return_customers: 0,
          return_rate_pct: null,
        },
        ongoing: { customers: 0, returned_customers: 0 },
      },
    ],
  };
}
const report = (options = {}) => getFirstPurchaseReturns({ businessId, now, ...options }, query);

describe("weekly first purchase report contract", () => {
  it("offers exactly 52 local Mondays newest first and defaults to the previous complete week", async () => {
    const out = await report();
    assert.equal(out.available_weeks.length, 52);
    assert.equal(new Set(out.available_weeks).size, 52);
    assert.deepEqual(out.available_weeks.slice(0, 2), ["2026-11-16", "2026-11-09"]);
    assert.equal(out.available_weeks.at(-1), "2025-11-24");
    assert.equal(out.cohort.week_start, "2026-11-09");
    assert.equal(out.cohort.week_end, "2026-11-15");
    assert.equal(out.cohort.customers, 0);
    assert.equal(out.follow_up.definition, "later_local_day_within_720_hours");
    assert.equal(out.generated_at, now.toISOString());
    assert.deepEqual(out.scope, {
      branch_id: null,
      first_purchase_scope: "business",
      return_scope: "business",
    });
    assert.equal(out.data_readiness.state, "recorded_only");
  });
  it("chooses the local week before UTC Monday has started locally", async () => {
    const out = await report({ now: new Date("2026-11-16T05:59:59.999Z") });
    assert.equal(out.available_weeks[0], "2026-11-09");
    assert.equal(out.cohort.week_start, "2026-11-02");
  });
  it("accepts current and oldest choices without changing the requested week", async () => {
    for (const weekStart of ["2026-11-16", "2025-11-24"]) {
      const out = await report({ weekStart, branchId });
      assert.equal(out.cohort.week_start, weekStart);
      assert.equal(out.scope.branch_id, branchId);
      assert.deepEqual(queries.at(-1).params, [
        businessId,
        branchId,
        weekStart,
        "America/Guatemala",
        now.toISOString(),
      ]);
    }
  });
  it("rejects malformed, impossible, non-Monday, future and out-of-range weeks before querying history", async () => {
    for (const weekStart of [
      "",
      "2026-2-02",
      "2026-02-30",
      "2026-11-17",
      "2026-11-23",
      "2025-11-17",
      20261109,
      null,
    ]) {
      await assert.rejects(report({ weekStart }), { statusCode: 400 }, String(weekStart));
    }
    assert.equal(
      queries.some((item) => item.sql.includes("FROM transactions")),
      false,
    );
  });
  it("rejects a missing business and branches outside the authenticated tenant", async () => {
    await assert.rejects(report({ branchId: randomUUID() }), { statusCode: 400 });
    assert.deepEqual(queries.at(-1).params.slice(1), [businessId]);
    business = null;
    await assert.rejects(report(), { statusCode: 404 });
  });
  it("surfaces blocked freshness without describing an incomplete source as complete", async () => {
    business = {
      program_json: { pos_integration: { mode: "loyverse", automatic: true, enabled: true } },
    };
    const out = await report();
    assert.equal(out.data_readiness.state, "blocked");
    assert.equal(out.data_readiness.reason, "initial_sync_incomplete");
    assert.equal(out.data_readiness.inactivity_allowed, false);
    assert.ok(out.notes.some((note) => note.includes("causadas")));
  });
});
