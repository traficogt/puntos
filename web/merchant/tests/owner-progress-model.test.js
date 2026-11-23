import test from "node:test";
import assert from "node:assert/strict";
import { availableGoals, ownerGoalCatalog, goalProgressText, goalProgressPct, momentumText, latestMilestone, nextLaunchStep, launchStepsText, launchPct, reachedMilestones, pendingMilestones, showsFullProgress, progressDate } from "../src/owner-progress-model.ts";

const step = (key, done) => ({ key, label: key, done, done_at: done ? "2026-11-01T12:00:00Z" : null, href: `#${key}` });
const launch = (doneCount) => {
  const steps = ["rules", "card", "practice", "team", "live"].map((key, index) => step(key, index < doneCount));
  return { steps, done_count: doneCount, total: 5, complete: doneCount === 5 };
};
const milestone = (key, reached_at = null) => ({ key, label: key, reached_at, acknowledged_at: null });

test("the goal catalog follows the documented priority order", () => {
  assert.deepEqual(ownerGoalCatalog.map((goal) => goal.key), ["launch", "first_customer", "redemption_comfort", "returning_5", "reward_speed_review", "monthly_review"]);
});

test("before the launch path completes only the goals that apply are offered", () => {
  const keys = availableGoals({ launch: launch(2), milestones: [], goal: null }).map((goal) => goal.key);
  assert.deepEqual(keys, ["launch", "first_customer", "returning_5"]);
});

test("a mid-progress café is offered the remaining alternatives, never the current goal", () => {
  const state = {
    launch: launch(5),
    milestones: [milestone("pionero", "2026-10-13T18:00:00Z"), milestone("first_customer", "2026-10-17T13:05:00Z"), milestone("programa_en_marcha", "2026-11-09T15:30:00Z"), milestone("primera_recompensa"), milestone("ya_estan_volviendo")],
    goal: { key: "returning_5", label: "Cinco clientes con una visita posterior registrada", progress: { current: 3, target: 5 }, href: "#clientes" },
  };
  assert.deepEqual(availableGoals(state).map((goal) => goal.key), ["redemption_comfort", "reward_speed_review", "monthly_review"]);
  assert.deepEqual(availableGoals(state, null).map((goal) => goal.key), ["redemption_comfort", "returning_5", "reward_speed_review", "monthly_review"]);
  const afterRedemption = { ...state, milestones: [...state.milestones.filter((row) => row.key !== "primera_recompensa"), milestone("primera_recompensa", "2026-11-10T10:00:00Z")] };
  assert.deepEqual(availableGoals(afterRedemption).map((goal) => goal.key), ["monthly_review"]);
});

test("progress copy is factual and only counts what the server sent", () => {
  const goal = { key: "returning_5", label: "x", progress: { current: 3, target: 5 }, href: "#" };
  assert.equal(goalProgressText(goal), "3 de 5 clientes con una visita posterior registrada");
  assert.equal(goalProgressPct(goal), 60);
  assert.equal(goalProgressText({ key: "otra", label: "x", progress: { current: 1, target: 4 }, href: "#" }), "1 de 4");
  assert.equal(goalProgressText({ key: "monthly_review", label: "x", href: "#" }), null);
  assert.equal(goalProgressPct({ key: "monthly_review", label: "x", progress: { current: 2, target: 0 }, href: "#" }), null);
  assert.equal(launchStepsText(launch(3)), "3 de 5 pasos");
  assert.equal(launchPct(launch(3)), 60);
  assert.equal(nextLaunchStep(launch(3)).key, "team");
  assert.equal(nextLaunchStep(launch(5)), null);
});

test("milestones sort by date, momentum reads as secondary text and mode gates the full view", () => {
  const rows = [milestone("a", "2026-10-01T00:00:00Z"), milestone("b"), milestone("c", "2026-11-01T00:00:00Z"), milestone("d", "not a date")];
  assert.deepEqual(reachedMilestones(rows).map((row) => row.key), ["c", "a"]);
  assert.deepEqual(pendingMilestones(rows).map((row) => row.key), ["b", "d"]);
  assert.equal(latestMilestone(rows).key, "c");
  assert.equal(latestMilestone([]), null);
  assert.equal(momentumText({ weeks: 3, current_week_active: true, freezes_available: 1 }), "Impulso: 3 semanas seguidas con actividad · esta semana ya cuenta · 1 pausa disponible");
  assert.equal(momentumText({ weeks: 0, current_week_active: false, freezes_available: 0 }), "Impulso: todavía sin semanas seguidas con actividad · esta semana aún sin actividad · 0 pausas disponibles");
  assert.equal(showsFullProgress({ mode: "full", variant: "treatment" }), true);
  assert.equal(showsFullProgress({ mode: "checklist", variant: "treatment" }), false);
  assert.equal(showsFullProgress({ mode: "full", variant: "holdout" }), false);
  assert.equal(progressDate(null), null);
  assert.equal(progressDate("nope"), null);
  assert.match(progressDate("2026-11-09T15:30:00Z"), /2026/);
});
