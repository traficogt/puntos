import { test } from "node:test";
import assert from "node:assert/strict";
import { stampCard } from "../../src/app/services/stamp-model.js";
import { evaluatePointRules } from "../../src/app/services/transaction-rule-evidence.js";

test("stampCard returns null for non-stamp programs", () => {
  assert.equal(stampCard({ program_type: "SPEND", program_json: {} }, { points: 5 }), null);
  assert.equal(stampCard(null, { points: 5 }), null);
});

test("a 10-space card with a 2-stamp head start needs 8 real purchases", () => {
  const b = {
    program_type: "STAMP",
    program_json: { stamps_required: 10, head_start: 2, reward_label: "Cafe gratis" },
  };
  assert.deepEqual(stampCard(b, { points: 0 }), {
    stamps_required: 10,
    head_start: 2,
    reward_label: "Cafe gratis",
    unit: "visit",
    earned: 0,
    filled: 2,
    purchases_required: 8,
    remaining: 8,
    complete: false,
  });
  const mid = stampCard(b, { points: 3 });
  assert.equal(mid.filled, 5); // 2 gifted + 3 earned
  assert.equal(mid.remaining, 5);
  const done = stampCard(b, { points: 8 });
  assert.equal(done.complete, true);
  assert.equal(done.remaining, 0);
  assert.equal(done.filled, 10);
});

test("stampCard defaults, and clamps a malformed config", () => {
  const d = stampCard({ program_type: "STAMP", program_json: {} }, { points: 3 });
  assert.equal(d.stamps_required, 10);
  assert.equal(d.head_start, 0); // helper reflects stored value; launch patch materialises the default of 2
  assert.equal(d.reward_label, "Premio");
  assert.equal(d.unit, "visit");
  assert.equal(d.purchases_required, 10);
  // a head start can never consume the whole card
  assert.equal(
    stampCard(
      { program_type: "STAMP", program_json: { stamps_required: 10, head_start: 20 } },
      { points: 0 },
    ).head_start,
    9,
  );
  // over-collected balance never shows more than the card length
  assert.equal(
    stampCard(
      { program_type: "STAMP", program_json: { stamps_required: 8, head_start: 2 } },
      { points: 25 },
    ).filled,
    8,
  );
});

test("a stamp program awards exactly one stamp per visit", () => {
  const now = new Date("2026-11-20T18:00:00Z");
  const b = {
    program_type: "STAMP",
    program_json: { stamps_required: 10, head_start: 2, reward_label: "Cafe gratis" },
  };
  const perVisit = evaluatePointRules(
    b,
    { amount_q: 500, visits: 1 },
    { now, timeZone: "America/Guatemala" },
  );
  assert.equal(perVisit.points, 1);
  assert.equal(perVisit.evidence.program.type, "STAMP");
  assert.equal(
    evaluatePointRules(b, { amount_q: 500 }, { now, timeZone: "America/Guatemala" }).points,
    1,
  );
});

test("a stamp program can count items instead of visits", () => {
  const now = new Date("2026-11-20T18:00:00Z");
  const b = { program_type: "STAMP", program_json: { stamps_required: 10, stamp_unit: "item" } };
  assert.equal(
    evaluatePointRules(b, { amount_q: 90, items: 3 }, { now, timeZone: "America/Guatemala" })
      .points,
    3,
  );
});
