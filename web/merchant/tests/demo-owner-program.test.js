import test from "node:test";
import assert from "node:assert/strict";
import { demoApi } from "../src/demo-api.js";
import { createOwnerProgramDemoApi } from "../src/demo-owner-program.ts";

const json = (body) => ({ method: "POST", body: JSON.stringify(body) });

test("owner configuration screens have preview data and never reach fetch", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Unexpected network");
  };
  try {
    const plan = await demoApi("/api/admin/plan");
    for (const flag of ["basic_reporting", "tiers", "gamification", "gift_cards", "program_rules", "fraud_monitoring"])
      assert.equal(plan.features[flag], true, flag);
    assert.equal(typeof plan.usage.active_customers, "number");
    assert.ok(plan.limits.activeCustomers > plan.usage.active_customers);
    assert.equal((await demoApi("/api/admin/branding")).customer_branding.branding_mode, "endorsed_brand");
    assert.ok((await demoApi("/api/admin/tiers")).tiers.length >= 2);
    assert.ok((await demoApi("/api/admin/achievements")).achievements.length >= 1);
    assert.ok((await demoApi("/api/admin/challenges")).challenges.length >= 1);
    assert.ok((await demoApi("/api/admin/gift-cards?limit=100")).gift_cards.length >= 1);
    assert.ok((await demoApi("/api/admin/awards/suspicious?limit=30")).awards.length >= 1);
    const program = await demoApi("/api/admin/program");
    assert.equal(program.program_type, "SPEND");
    assert.equal(program.program_json.points_per_q, 0.1);
    assert.ok(program.program_json.award_guard);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("preview edits stay in memory: tiers, gift cards and limits round-trip", async () => {
  const api = createOwnerProgramDemoApi();
  const call = (path, options) => api(new URL(path, "https://preview.invalid"), options);
  const { tier } = call("/api/admin/tiers", json({ name: "Platino", tier_level: 4, min_points: 9000, points_multiplier: 2, perks: ["Doble puntos"] }));
  assert.equal(tier.customer_count, 0);
  assert.throws(() => call("/api/admin/tiers", json({ name: "Repetido", tier_level: 4 })), /orden/);
  call(`/api/admin/tiers/${tier.id}`, { method: "PUT", body: JSON.stringify({ name: "Platino plus" }) });
  assert.equal(call("/api/admin/tiers").tiers.find((row) => row.id === tier.id).name, "Platino plus");
  assert.throws(() => call(`/api/admin/tiers/${call("/api/admin/tiers").tiers[0].id}`, { method: "DELETE" }), /clientes activos/);
  call(`/api/admin/tiers/${tier.id}`, { method: "DELETE" });
  assert.equal(call("/api/admin/tiers").tiers.some((row) => row.id === tier.id), false);

  const requestId = "11111111-2222-4333-8444-555555555555";
  const first = call("/api/admin/gift-cards", json({ amount_q: 75, issued_to_name: "Ana", requestId })).gift_card;
  const replay = call("/api/admin/gift-cards", json({ amount_q: 75, issued_to_name: "Ana", requestId })).gift_card;
  assert.equal(first.code, replay.code, "the same requestId never issues a second card");
  const ledger = call(`/api/admin/gift-cards/${first.code}/ledger`);
  assert.equal(ledger.ledger.mismatch, false);
  assert.equal(ledger.ledger.expected_balance_q, 75);

  const before = call("/api/admin/program");
  const saved = call("/api/admin/program", json({ program_type: before.program_type, program_json: { ...before.program_json, award_guard: { ...before.program_json.award_guard, max_points_per_tx: 999 } } }));
  assert.equal(saved.business.program_json.award_guard.max_points_per_tx, 999);
  assert.equal(saved.business.program_json.points_per_q, 0.1, "the earning rule survives a limits save");

  const { achievement } = call("/api/admin/achievements", json({ name: "Madrugador", requirement_type: "visits", requirement_value: 5, points_reward: 10, active: true }));
  call(`/api/admin/achievements/${achievement.id}`, { method: "PUT", body: JSON.stringify({ active: false }) });
  assert.equal(call("/api/admin/achievements").achievements.find((row) => row.id === achievement.id).active, false);
  const { challenge } = call("/api/admin/challenges", json({ name: "Futuro", challenge_type: "limited_time", requirement_type: "visits", requirement_value: 2, reward_points: 50, start_date: "2030-01-01T00:00:00.000Z", end_date: null, recurrence: null, active: true }));
  assert.equal(call("/api/admin/challenges").challenges.some((row) => row.id === challenge.id), false, "only running challenges are listed");
  assert.equal(call("/api/admin/unknown-owner-endpoint"), undefined);
});
