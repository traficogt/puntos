import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { cohortSqlConfigForType } = await import("../../src/app/repositories/analytics-repository.js");

describe("analytics-repository cohort config", () => {
  it("maps supported cohort types to the expected SQL parts", () => {
    assert.deepEqual(cohortSqlConfigForType("monthly"), {
      cohortType: "monthly",
      truncUnit: "month",
      cohortLabelSql: "to_char(DATE_TRUNC('month', cl.first_purchase_at), 'YYYY-MM')"
    });
    assert.deepEqual(cohortSqlConfigForType("weekly"), {
      cohortType: "weekly",
      truncUnit: "week",
      cohortLabelSql: "to_char(DATE_TRUNC('week', cl.first_purchase_at), 'IYYY-\"W\"IW')"
    });
    assert.deepEqual(cohortSqlConfigForType("quarterly"), {
      cohortType: "quarterly",
      truncUnit: "quarter",
      cohortLabelSql: "to_char(DATE_TRUNC('quarter', cl.first_purchase_at), 'YYYY-\"Q\"Q')"
    });
  });

  it("falls back to monthly for unknown cohort types", () => {
    assert.equal(cohortSqlConfigForType("yearly").cohortType, "monthly");
  });
});
