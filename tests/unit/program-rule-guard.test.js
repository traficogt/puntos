import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePoints, computePointsWithEvidence } from "../../src/app/services/points-service.js";
import { evaluatePointRules } from "../../src/app/services/transaction-rule-evidence.js";

const now = new Date("2026-11-22T12:00:00Z");

describe("earning rule guard (no silent default ratio)", () => {
  it("live computations refuse a points program whose rule was never set", () => {
    for (const business of [
      { program_type: "SPEND", program_json: {} },
      { program_type: "VISIT", program_json: {} },
      { program_type: "ITEM", program_json: { round: "ceil" } },
    ]) {
      assert.throws(
        () => computePoints(business, { amount_q: 100, visits: 1, items: 1 }),
        (err) => err instanceof Error && /** @type {any} */ (err).code === "PROGRAM_NOT_CONFIGURED",
        JSON.stringify(business),
      );
    }
  });
  it("live computations work once the owner has chosen a rule", () => {
    assert.equal(
      computePoints({ program_type: "SPEND", program_json: { points_per_q: 1 } }, { amount_q: 25 }),
      25,
    );
    assert.equal(
      computePoints({ program_type: "STAMP", program_json: { stamps_required: 8 } }, { visits: 1 }),
      1,
    );
  });
  it("evidence and replay callers keep the legacy defaults so historical records still reconstruct", () => {
    const direct = evaluatePointRules(
      { program_type: "SPEND", program_json: {} },
      { amount_q: 100 },
      { now, timeZone: "UTC" },
    );
    assert.equal(direct.points, 10);
    const optedOut = computePointsWithEvidence(
      { program_type: "SPEND", program_json: {} },
      { amount_q: 100 },
      { now, timeZone: "UTC", requireRule: false },
    );
    assert.equal(optedOut.points, 10);
  });
});
