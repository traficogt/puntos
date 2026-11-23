import test from "node:test";
import assert from "node:assert/strict";
import { demoApi } from "../src/demo-api.js";
import { createOwnerProgressDemoApi } from "../src/demo-owner-progress.ts";

const json = (body) => ({ method: "POST", body: JSON.stringify(body) });
const client = (api) => (path, options) => api(new URL(path, "https://preview.invalid"), options);

test("the demo café shows a mid-progress 'Tu progreso' through the demo dispatcher without fetch", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Unexpected network"); };
  try {
    const progress = await demoApi("/api/admin/owner-progress");
    assert.equal(progress.mode, "full");
    assert.equal(progress.variant, "treatment");
    assert.equal(progress.hidden, false);
    assert.equal(progress.launch.complete, true);
    assert.equal(progress.launch.done_count, 5);
    assert.equal(progress.launch.total, 5);
    assert.deepEqual(progress.launch.steps.map((step) => step.key), ["rules", "card", "practice", "team", "live"]);
    assert.ok(progress.launch.steps.every((step) => step.done && step.done_at && step.href.startsWith("#")));
    assert.equal(progress.goal.key, "returning_5");
    assert.deepEqual(progress.goal.progress, { current: 3, target: 5 });
    assert.equal(progress.goal.href, "#clientes");
    assert.deepEqual(progress.new_milestones, ["programa_en_marcha"]);
    assert.deepEqual(progress.momentum, { weeks: 3, current_week_active: true, freezes_available: 1 });
    assert.equal(progress.milestones.length, 14);
    assert.deepEqual(progress.milestones.filter((row) => row.reached_at).map((row) => row.key), ["programa_en_marcha", "first_customer", "pionero"]);
    assert.equal(JSON.stringify(progress).toLowerCase().includes("gamificaci"), false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("demo actions mutate the in-memory state: acknowledge, goal, dismiss, review and visibility", () => {
  const call = client(createOwnerProgressDemoApi());
  assert.deepEqual(call("/api/admin/owner-progress/acknowledge", json({ keys: ["programa_en_marcha"] })), { ok: true });
  let state = call("/api/admin/owner-progress");
  assert.deepEqual(state.new_milestones, []);
  assert.ok(state.milestones.find((row) => row.key === "programa_en_marcha").acknowledged_at);
  assert.throws(() => call("/api/admin/owner-progress/acknowledge", json({ keys: "programa_en_marcha" })), /hitos/);

  call("/api/admin/owner-progress/goal", json({ key: "monthly_review" }));
  state = call("/api/admin/owner-progress");
  assert.equal(state.goal.key, "monthly_review");
  assert.equal(state.goal.progress, null);
  assert.equal(state.goal.href, "#reportes");
  assert.throws(() => call("/api/admin/owner-progress/goal", json({ key: "launch" })), /disponible/);
  assert.throws(() => call("/api/admin/owner-progress/goal", json({ key: "nope" })), /existe/);
  call("/api/admin/owner-progress/goal", json({ dismiss: "monthly_review" }));
  assert.equal(call("/api/admin/owner-progress").goal.key, "redemption_comfort", "the next goal in priority order replaces a dismissed one");
  for (const key of ["redemption_comfort", "returning_5", "reward_speed_review"]) call("/api/admin/owner-progress/goal", json({ dismiss: key }));
  assert.equal(call("/api/admin/owner-progress").goal, null, "with every remaining goal dismissed there is no suggestion");

  call("/api/admin/owner-progress/review", json({ decision: "keep", note: "La recompensa parece alcanzable." }));
  state = call("/api/admin/owner-progress");
  assert.ok(state.milestones.find((row) => row.key === "primera_revision").reached_at);
  assert.deepEqual(state.new_milestones, ["primera_revision"]);
  assert.throws(() => call("/api/admin/owner-progress/review", json({ decision: "delete" })), /mantienes/);

  call("/api/admin/owner-progress/visibility", json({ hidden: true }));
  assert.equal(call("/api/admin/owner-progress").hidden, true);
  call("/api/admin/owner-progress/visibility", json({ hidden: false }));
  assert.equal(call("/api/admin/owner-progress").hidden, false);
  assert.throws(() => call("/api/admin/owner-progress/visibility", json({ hidden: "yes" })), /ocultar/);
  assert.equal(call("/api/admin/unrelated"), undefined);
});

test("mode off answers 404 so the UI renders nothing", () => {
  const call = client(createOwnerProgressDemoApi({ mode: "off" }));
  assert.throws(() => call("/api/admin/owner-progress"), (error) => error.status === 404);
});
