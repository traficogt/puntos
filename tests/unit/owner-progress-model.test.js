import test from "node:test";
import assert from "node:assert/strict";
import {
  GOAL_KEYS,
  LAUNCH_STEPS,
  MILESTONE_KEYS,
  OwnerProgressSettingsSchema,
  assignOwnerProgressVariant,
  buildOwnerProgress,
  computeMomentum,
  getOwnerProgress,
  resolveOwnerProgressSettings,
  weekStartOf,
} from "../../src/app/services/owner-progress-service.js";

const TZ = "America/Guatemala";
// Sunday 2026-11-22 21:00 in Guatemala (UTC-6) is already Monday 2026-11-23 in UTC.
const now = new Date("2026-11-23T03:00:00Z");
const facts = (overrides = {}) => ({
  program_configured: false,
  active_rewards: 0,
  enrollment_sources: 0,
  first_source_at: null,
  branded_qr_enabled: false,
  practice_completed: 0,
  first_practice_at: null,
  team_ready: 0,
  genuine_awards: 0,
  first_award_at: null,
  returning_customers: 0,
  genuine_redemptions: 0,
  first_redemption_at: null,
  active_customers: 0,
  automation_live: false,
  campaigns_measured: 0,
  wallet_passes: 0,
  pos_connected: false,
  pilot: false,
  award_weeks: [],
  todo_weeks: [],
  ...overrides,
});
const full = (f, extra = {}) =>
  buildOwnerProgress(f, { mode: "full", variant: "treatment", now, timezone: TZ, ...extra });

test("launch path keeps the design order and counts only satisfied steps", () => {
  assert.deepEqual(
    LAUNCH_STEPS.map((s) => s.key),
    ["rules", "card", "practice", "team", "live"],
  );
  const empty = full(facts()).payload;
  assert.equal(empty.launch.total, 5);
  assert.equal(empty.launch.done_count, 0);
  assert.equal(empty.launch.complete, false);
  assert.deepEqual(
    empty.launch.steps.map((s) => s.done),
    [false, false, false, false, false],
  );
  // Rules need both a configured program and an active reward.
  assert.equal(
    full(facts({ program_configured: true })).payload.launch.steps[0].done,
    false,
    "a configured program without a reward is not ready",
  );
  const ready = full(
    facts({
      program_configured: true,
      active_rewards: 1,
      enrollment_sources: 1,
      first_source_at: "2026-11-02T15:00:00Z",
      practice_completed: 1,
      first_practice_at: "2026-11-03T15:00:00Z",
      team_ready: 1,
      genuine_awards: 1,
      first_award_at: "2026-11-04T15:00:00Z",
      award_weeks: ["2026-11-02"],
    }),
  ).payload;
  assert.equal(ready.launch.complete, true);
  assert.equal(ready.launch.steps[1].done_at, "2026-11-02T15:00:00.000Z");
  assert.equal(ready.launch.steps[4].done_at, "2026-11-04T15:00:00.000Z");
  assert.ok(ready.milestones.find((m) => m.key === "programa_en_marcha").reached_at);
  assert.ok(ready.milestones.find((m) => m.key === "primer_cliente").reached_at);
  assert.equal(ready.milestones.find((m) => m.key === "ya_estan_volviendo").reached_at, null);
  assert.ok(ready.launch.steps.every((s) => typeof s.href === "string" && s.href.length));
});

test("milestones follow the v2 table, including granted pionero and recorded review", () => {
  assert.deepEqual(MILESTONE_KEYS, [
    "programa_en_marcha",
    "primer_cliente",
    "ya_estan_volviendo",
    "primera_recompensa",
    "primera_revision",
    "clientes_50",
    "clientes_100",
    "clientes_300",
    "primera_automatizacion",
    "primera_campana_medida",
    "primer_pase_wallet",
    "pos_conectado",
    "momentum_4",
    "pionero",
  ]);
  const result = full(
    facts({
      returning_customers: 5,
      genuine_redemptions: 1,
      active_customers: 120,
      automation_live: true,
      campaigns_measured: 1,
      wallet_passes: 1,
      pos_connected: true,
      pilot: true,
    }),
    { state: { last_review_at: "2026-11-20T10:00:00Z", last_review_decision: "keep" } },
  );
  assert.deepEqual(result.satisfied.sort(), [
    "clientes_100",
    "clientes_50",
    "pionero",
    "pos_conectado",
    "primer_pase_wallet",
    "primera_automatizacion",
    "primera_campana_medida",
    "primera_recompensa",
    "primera_revision",
    "ya_estan_volviendo",
  ]);
  assert.deepEqual(result.payload.review, { at: "2026-11-20T10:00:00.000Z", decision: "keep" });
});

test("new_milestones lists reached but unacknowledged milestones using stored first-reached times", () => {
  const stored = [
    { key: "primer_cliente", reached_at: "2026-10-01T12:00:00Z", acknowledged_at: null },
    {
      key: "pionero",
      reached_at: "2026-09-01T12:00:00Z",
      acknowledged_at: "2026-09-02T12:00:00Z",
    },
  ];
  const { payload } = full(facts({ genuine_awards: 3, pilot: true, wallet_passes: 1 }), {
    stored,
  });
  const byKey = Object.fromEntries(payload.milestones.map((m) => [m.key, m]));
  assert.equal(byKey.primer_cliente.reached_at, "2026-10-01T12:00:00.000Z");
  assert.equal(byKey.pionero.acknowledged_at, "2026-09-02T12:00:00.000Z");
  assert.equal(byKey.primer_pase_wallet.reached_at, now.toISOString());
  assert.deepEqual(payload.new_milestones, ["primer_cliente", "primer_pase_wallet"]);
});

test("weeks start on Monday in the business timezone, not in UTC", () => {
  assert.equal(weekStartOf(now, TZ), "2026-11-16");
  assert.equal(weekStartOf(now, "UTC"), "2026-11-23");
  assert.equal(weekStartOf(new Date("2026-11-23T06:00:00Z"), TZ), "2026-11-23");
});

test("momentum counts consecutive weeks, treats quiet weeks as active and freezes one gap per 8 weeks", () => {
  assert.deepEqual(computeMomentum(facts(), { now, timezone: TZ }), {
    weeks: 0,
    current_week_active: false,
    freezes_available: 1,
    frozen_weeks: 0,
  });
  // Three consecutive award weeks ending in the current (in-progress) week.
  let m = computeMomentum(facts({ award_weeks: ["2026-11-16", "2026-11-09", "2026-11-02"] }), {
    now,
    timezone: TZ,
  });
  assert.equal(m.weeks, 3);
  assert.equal(m.current_week_active, true);
  // A quiet current week does not break the run; it is simply not counted yet.
  m = computeMomentum(facts({ award_weeks: ["2026-11-09", "2026-11-02"] }), { now, timezone: TZ });
  assert.equal(m.weeks, 2);
  assert.equal(m.current_week_active, false);
  // A week without awards but with nothing for the owner to do counts as active.
  m = computeMomentum(facts({ award_weeks: ["2026-11-16", "2026-11-02"] }), { now, timezone: TZ });
  assert.equal(m.weeks, 3);
  // A week without awards but with pending owner work consumes the single freeze.
  m = computeMomentum(
    facts({ award_weeks: ["2026-11-16", "2026-11-02"], todo_weeks: ["2026-11-09"] }),
    { now, timezone: TZ },
  );
  assert.equal(m.weeks, 2);
  assert.equal(m.frozen_weeks, 1);
  assert.equal(m.freezes_available, 0);
  // Two such weeks inside the first 8 weeks break the run.
  m = computeMomentum(
    facts({
      award_weeks: ["2026-11-16", "2026-10-26"],
      todo_weeks: ["2026-11-09", "2026-11-02"],
    }),
    { now, timezone: TZ },
  );
  assert.equal(m.weeks, 1);
  // Weeks before the first genuine award are never counted.
  m = computeMomentum(facts({ award_weeks: ["2026-11-16"] }), { now, timezone: TZ });
  assert.equal(m.weeks, 1);
  // A nine-week run earns a second freeze.
  const nine = [];
  for (let i = 0; i < 9; i++)
    nine.push(weekStartOf(new Date(now.getTime() - i * 7 * 86400000), TZ));
  m = computeMomentum(facts({ award_weeks: nine }), { now, timezone: TZ });
  assert.equal(m.weeks, 9);
  assert.equal(m.freezes_available, 2);
  // Twelve weeks with two gaps: the first gap uses the starting freeze, the second is
  // covered by the freeze earned after eight weeks of the run.
  const twelve = [];
  for (let i = 0; i < 12; i++)
    twelve.push(weekStartOf(new Date(now.getTime() - i * 7 * 86400000), TZ));
  const gaps = [twelve[9], twelve[1]];
  m = computeMomentum(
    facts({ award_weeks: twelve.filter((w) => !gaps.includes(w)), todo_weeks: gaps }),
    { now, timezone: TZ },
  );
  assert.equal(m.weeks, 10);
  assert.equal(m.frozen_weeks, 2);
  assert.equal(m.freezes_available, 0);
  // Two gaps inside the first eight weeks reset the run at the second gap.
  const early = [twelve[9], twelve[6]];
  m = computeMomentum(
    facts({ award_weeks: twelve.filter((w) => !early.includes(w)), todo_weeks: early }),
    { now, timezone: TZ },
  );
  assert.equal(m.weeks, 6);
  assert.equal(m.frozen_weeks, 0);
  assert.equal(m.freezes_available, 1);
  // momentum_4 is a milestone of the model.
  const four = nine.slice(0, 4);
  assert.ok(full(facts({ award_weeks: four })).satisfied.includes("momentum_4"));
});

test("suggested goal follows the priority list and respects choice and 30-day dismissals", () => {
  assert.deepEqual(GOAL_KEYS, [
    "launch",
    "first_customer",
    "redemption_comfort",
    "returning_5",
    "reward_speed_review",
    "monthly_review",
  ]);
  const live = facts({
    program_configured: true,
    active_rewards: 1,
    enrollment_sources: 1,
    practice_completed: 1,
    team_ready: 1,
    genuine_awards: 4,
    first_award_at: "2026-11-10T12:00:00Z",
    returning_customers: 2,
    award_weeks: ["2026-11-09", "2026-11-16"],
  });
  assert.equal(full(facts()).payload.goal.key, "launch");
  assert.deepEqual(full(facts()).payload.goal.progress, { current: 0, target: 5 });
  assert.equal(full(live).payload.goal.key, "redemption_comfort");
  assert.equal(
    full(live, { state: { current_goal: "returning_5" } }).payload.goal.key,
    "returning_5",
  );
  assert.deepEqual(full(live, { state: { current_goal: "returning_5" } }).payload.goal.progress, {
    current: 2,
    target: 5,
  });
  // A chosen goal that no longer applies falls back to the suggestion.
  assert.equal(
    full(live, { state: { current_goal: "launch" } }).payload.goal.key,
    "redemption_comfort",
  );
  const dismissed = { redemption_comfort: "2026-11-20T00:00:00Z" };
  assert.equal(
    full(live, { state: { dismissed_goals: dismissed } }).payload.goal.key,
    "returning_5",
  );
  const expired = { redemption_comfort: "2026-10-01T00:00:00Z" };
  assert.equal(
    full(live, { state: { dismissed_goals: expired } }).payload.goal.key,
    "redemption_comfort",
  );
  // Review goals appear 30 days after the first award and clear once a review is recorded.
  const month = facts({ ...live, first_award_at: "2026-10-01T12:00:00Z", returning_customers: 6 });
  assert.equal(full(month).payload.goal.key, "redemption_comfort");
  const dismissedAll = { redemption_comfort: "2026-11-20T00:00:00Z" };
  assert.equal(
    full(month, { state: { dismissed_goals: dismissedAll } }).payload.goal.key,
    "reward_speed_review",
  );
  assert.equal(
    full(month, {
      state: { dismissed_goals: dismissedAll, last_review_at: "2026-11-21T00:00:00Z" },
    }).payload.goal,
    null,
  );
  assert.equal(
    full(
      { ...month, genuine_redemptions: 2 },
      { state: { last_review_at: "2026-09-01T00:00:00Z" } },
    ).payload.goal.key,
    "monthly_review",
  );
});

test("holdout and checklist mode expose the launch path only", () => {
  const f = facts({ genuine_awards: 3, pilot: true, award_weeks: ["2026-11-16"] });
  for (const options of [
    { mode: "full", variant: "holdout" },
    { mode: "checklist", variant: "treatment" },
  ]) {
    const { payload, satisfied } = buildOwnerProgress(f, { ...options, now, timezone: TZ });
    assert.equal(payload.experience, "checklist");
    assert.equal(payload.launch.total, 5);
    assert.equal(payload.goal, null);
    assert.deepEqual(payload.milestones, []);
    assert.equal(payload.momentum, null);
    assert.deepEqual(payload.new_milestones, []);
    // Facts are still evaluated so first-reached times can be stored for every variant.
    assert.ok(satisfied.includes("primer_cliente"));
  }
  const treatment = full(f).payload;
  assert.equal(treatment.experience, "full");
  assert.equal(treatment.hidden, false);
  assert.equal(full(f, { state: { hidden: true } }).payload.hidden, true);
});

test("mode off is a 404 before any tenant query runs", async () => {
  const calls = [];
  await assert.rejects(
    getOwnerProgress(
      {
        businessId: "11111111-1111-4111-8111-111111111111",
        settings: { mode: "off", holdout_pct: 0 },
      },
      {
        query: async (sql) => {
          calls.push(sql);
          return { rows: [] };
        },
      },
    ),
    (/** @type {any} */ error) => error.statusCode === 404 && error.code === "NOT_FOUND",
  );
  assert.deepEqual(calls, []);
});

test("variant assignment is deterministic from the business id and the holdout share", () => {
  const ids = Array.from(
    { length: 400 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  for (const id of ids) {
    assert.equal(assignOwnerProgressVariant(id, 0), "treatment");
    assert.equal(assignOwnerProgressVariant(id, 100), "holdout");
    assert.equal(assignOwnerProgressVariant(id, 50), assignOwnerProgressVariant(id, 50));
  }
  const holdouts = ids.filter((id) => assignOwnerProgressVariant(id, 50) === "holdout").length;
  assert.ok(holdouts > 120 && holdouts < 280, `about half should be holdout, got ${holdouts}`);
});

test("platform settings validate strictly and normalize malformed stored values", () => {
  assert.deepEqual(resolveOwnerProgressSettings(undefined), { mode: "full", holdout_pct: 0 });
  assert.deepEqual(resolveOwnerProgressSettings({ mode: "nope", holdout_pct: 250 }), {
    mode: "full",
    holdout_pct: 0,
  });
  assert.deepEqual(resolveOwnerProgressSettings({ mode: "checklist", holdout_pct: 30 }), {
    mode: "checklist",
    holdout_pct: 30,
  });
  assert.ok(OwnerProgressSettingsSchema.safeParse({ mode: "off", holdout_pct: 0 }).success);
  for (const bad of [
    { mode: "x", holdout_pct: 0 },
    { mode: "full", holdout_pct: 101 },
    { mode: "full", holdout_pct: -1 },
    { mode: "full", holdout_pct: 2.5 },
    { mode: "full" },
    { mode: "full", holdout_pct: 10, extra: true },
  ])
    assert.equal(OwnerProgressSettingsSchema.safeParse(bad).success, false, JSON.stringify(bad));
});
