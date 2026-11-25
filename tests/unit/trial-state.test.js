import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTrialEnd,
  formatTrialDate,
  trialDaysLeft,
  trialState,
  TRIAL_COPY,
  TRIAL_EXPIRING_DAYS,
} from "../../src/app/services/trial-state.js";

const GT = "America/Guatemala";
const DAY = 86_400_000;

test("the trial end keeps the local wall-clock time 14 days later in the business timezone", () => {
  const start = new Date("2026-11-25T21:00:00.000Z"); // 15:00 in Guatemala (no DST)
  assert.equal(
    computeTrialEnd(start, 14, GT).toISOString(),
    new Date(start.getTime() + 14 * DAY).toISOString(),
  );
  // A zone that observes DST: 1 March 2026 02:00Z is 21:00 local (EST) on 28 Feb; 14 days
  // later the clocks have moved to EDT, so the same local time is one UTC hour earlier.
  const spring = new Date("2026-03-01T02:00:00.000Z");
  const end = computeTrialEnd(spring, 14, "America/New_York");
  assert.equal(end.getTime(), spring.getTime() + 14 * DAY - 3_600_000);
  assert.throws(() => computeTrialEnd(start, 0, GT), RangeError);
  assert.throws(() => computeTrialEnd(start, 14.5, GT), RangeError);
  assert.throws(() => computeTrialEnd("not a date", 14, GT), TypeError);
});

test("days left are local calendar days, 1 the day before the end and 0 on the last day or after", () => {
  const endsAt = new Date("2026-12-09T21:00:00.000Z"); // 9 Dec 15:00 GT
  assert.equal(trialDaysLeft(endsAt, new Date("2026-11-25T21:00:00.000Z"), GT), 14);
  assert.equal(trialDaysLeft(endsAt, new Date("2026-12-05T15:00:00.000Z"), GT), 4, "day 10");
  assert.equal(trialDaysLeft(endsAt, new Date("2026-12-08T15:00:00.000Z"), GT), 1, "day 13");
  assert.equal(trialDaysLeft(endsAt, new Date("2026-12-09T15:00:00.000Z"), GT), 0, "last day");
  assert.equal(trialDaysLeft(endsAt, new Date("2026-12-09T21:00:00.000Z"), GT), 0, "at the end");
  assert.equal(trialDaysLeft(endsAt, new Date("2026-12-20T00:00:00.000Z"), GT), 0, "after");
  // Local midnight is the boundary: 23:59 GT on 7 Dec (05:59Z on the 8th) is still 2 days.
  assert.equal(trialDaysLeft(endsAt, new Date("2026-12-08T05:59:00.000Z"), GT), 2);
  assert.equal(trialDaysLeft(endsAt, new Date("2026-12-08T06:00:00.000Z"), GT), 1);
  // The same instants read differently in another zone (UTC flips a day earlier here).
  assert.equal(trialDaysLeft(endsAt, new Date("2026-12-08T05:59:00.000Z"), "UTC"), 1);
});

test("trial status: active, expiring at 3 days, locked at the end (pending the job), converted and legacy none", () => {
  const started = new Date("2026-11-25T21:00:00.000Z");
  const endsAt = computeTrialEnd(started, 14, GT);
  const trialing = {
    trial_status: "active",
    billing_status: "trialing",
    trial_started_at: started,
    trial_ends_at: endsAt,
  };
  const fresh = trialState(trialing, { now: started, timezone: GT });
  assert.equal(fresh.status, "active");
  assert.equal(fresh.days_left, 14);
  assert.equal(fresh.locked, false);
  assert.equal(fresh.ends_at, endsAt.toISOString());
  assert.equal(TRIAL_EXPIRING_DAYS, 3);
  assert.equal(
    trialState(trialing, { now: new Date(endsAt.getTime() - 4 * DAY), timezone: GT }).status,
    "active",
    "4 days left is still active",
  );
  const day11 = trialState(trialing, { now: new Date(endsAt.getTime() - 3 * DAY), timezone: GT });
  assert.equal(day11.status, "expiring");
  assert.equal(day11.days_left, 3);
  const lastDay = trialState(trialing, {
    now: new Date(endsAt.getTime() - 3_600_000),
    timezone: GT,
  });
  assert.equal(lastDay.status, "expiring");
  assert.equal(lastDay.days_left, 0);
  assert.equal(lastDay.locked, false, "still writable until the end instant");
  const ended = trialState(trialing, { now: endsAt, timezone: GT });
  assert.equal(ended.status, "locked");
  assert.equal(ended.locked, true);
  assert.equal(ended.pending_lock, true, "locked before the daily job wrote the row");
  assert.equal(ended.days_left, 0);
  const locked = trialState(
    {
      ...trialing,
      trial_status: "expired",
      billing_status: "locked",
      locked_at: endsAt,
      purge_after: new Date(endsAt.getTime() + 30 * DAY),
    },
    { now: new Date(endsAt.getTime() + DAY), timezone: GT },
  );
  assert.equal(locked.status, "locked");
  assert.equal(locked.pending_lock, false);
  assert.equal(locked.purge_after, new Date(endsAt.getTime() + 30 * DAY).toISOString());
  for (const billing of ["active", "past_due", "canceled"]) {
    const paid = trialState(
      { ...trialing, trial_status: "converted", billing_status: billing },
      { now: new Date(endsAt.getTime() + 400 * DAY), timezone: GT },
    );
    assert.equal(paid.status, "converted", billing);
    assert.equal(paid.locked, false, billing);
  }
  const legacy = trialState({ trial_status: "none", billing_status: "none" }, { now: endsAt });
  assert.equal(legacy.status, "none");
  assert.equal(legacy.locked, false);
  assert.equal(legacy.days_left, null);
  assert.equal(trialState(null).status, "none");
  assert.equal(trialState({}).locked, false);
});

test("Spanish copy and dates follow the business timezone", () => {
  assert.equal(TRIAL_COPY.banner(14), "Prueba gratis · te quedan 14 días");
  assert.equal(TRIAL_COPY.banner(1), "Prueba gratis · te queda 1 día");
  assert.equal(TRIAL_COPY.banner(0), "Prueba gratis · termina hoy");
  assert.equal(formatTrialDate("2026-12-09T21:00:00.000Z", GT), "9 de diciembre de 2026");
  // 05:30Z is still 8 Dec in Guatemala but already 9 Dec in UTC.
  assert.equal(formatTrialDate("2026-12-09T05:30:00.000Z", GT), "8 de diciembre de 2026");
  assert.equal(formatTrialDate(null), "");
  assert.match(TRIAL_COPY.retention("9 de enero de 2027"), /hasta el 9 de enero de 2027/);
  assert.match(TRIAL_COPY.locked_error_owner, /Elige un plan/);
  assert.match(TRIAL_COPY.locked_error_staff, /dueño/);
});
