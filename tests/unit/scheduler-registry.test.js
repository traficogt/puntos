import test from "node:test";
import assert from "node:assert/strict";
import {
  API,
  WORKER,
  periodicJobs,
  startupTasks,
  dailySteps,
  jobsFor,
  forRole,
  dailyCronExpression,
  runSequence,
  startScheduler,
  stopScheduler,
  activeJobs,
} from "../../src/app/scheduler.js";
import { config } from "../../src/config/index.js";

const schedule = (job) =>
  job.cron ? `cron ${job.cron} ${job.timezone}` : `every ${job.everyMs}ms`;
const names = (entries) => entries.map((entry) => entry.name);

test("the registry declares every background job once with its schedule and process split", () => {
  assert.deepEqual(
    periodicJobs.map((job) => [job.name, schedule(job), [...job.runsIn].join("+")]),
    [
      ["native-wallet.updates", "every 60000ms", "api+worker"],
      ["mobile-push.updates", "every 30000ms", "worker"],
      ["webhooks.deliver", "every 60000ms", "api+worker"],
      ["jobs.process", `every ${config.JOB_WORKER_INTERVAL_MS}ms`, "api+worker"],
      ["marketing.tick", "every 60000ms", "api+worker"],
      ["guided-growth.tick", "every 60000ms", "worker"],
      ["pos.sync", "every 300000ms", "api+worker"],
      ["daily.maintenance", `cron ${dailyCronExpression()} ${config.CRON_TZ}`, "api+worker"],
    ],
  );
  assert.equal(new Set(names(periodicJobs)).size, periodicJobs.length, "job names are unique");
  for (const job of periodicJobs) {
    if (job.cron) assert.ok(Array.isArray(job.steps) && job.steps.length > 0, job.name);
    else assert.equal(typeof job.run, "function", job.name);
  }
});

test("daily maintenance keeps the business-calendar hour and orders the worker-only steps around lifecycle", () => {
  assert.equal(dailyCronExpression({ CHURN_SEND_HOUR_LOCAL: 9 }), "0 09 * * *");
  assert.equal(dailyCronExpression({ CHURN_SEND_HOUR_LOCAL: 14 }), "0 14 * * *");
  assert.deepEqual(names(forRole(dailySteps, WORKER)), [
    "support.purge-expired-attachments",
    "lifecycle.daily",
    "trial.daily",
    "billing.reconcile",
    "mfa.prune-counters",
    "ledger.reconcile-and-certify",
  ]);
  assert.deepEqual(names(forRole(dailySteps, API)), ["lifecycle.daily"]);
  assert.deepEqual(names(forRole(startupTasks, WORKER)), [
    "support.purge-expired-attachments",
    "secrets.rotate-to-current-key",
  ]);
  assert.deepEqual(names(forRole(startupTasks, API)), ["secrets.rotate-to-current-key"]);
});

test("the worker runs every job; the API runs its share only when in-process workers are enabled", () => {
  assert.deepEqual(names(jobsFor(WORKER, { inProcessWorkers: false })), names(periodicJobs));
  assert.deepEqual(names(jobsFor(WORKER, { inProcessWorkers: true })), names(periodicJobs));
  assert.deepEqual(names(jobsFor(API, { inProcessWorkers: true })), [
    "native-wallet.updates",
    "webhooks.deliver",
    "jobs.process",
    "marketing.tick",
    "pos.sync",
    "daily.maintenance",
  ]);
  assert.deepEqual(jobsFor(API, { inProcessWorkers: false }), []);
});

test("a failing step is logged with its error and does not block the following steps", async () => {
  const warnings = [];
  const log = { warn: (context, message) => warnings.push([context, message]) };
  const order = [];
  const completed = await runSequence(
    [
      { name: "one", runsIn: [WORKER], run: async () => order.push("one") },
      {
        name: "two",
        runsIn: [WORKER],
        run: async () => {
          throw new Error("database unavailable");
        },
      },
      { name: "three", runsIn: [WORKER], run: () => order.push("three") },
      {
        name: "four",
        runsIn: [WORKER],
        run: () => {
          throw "plain failure";
        },
      },
    ],
    WORKER,
    "Step did not complete",
    log,
  );
  assert.deepEqual(order, ["one", "three"]);
  assert.deepEqual(completed, ["one", "three"]);
  assert.deepEqual(warnings, [
    [{ err: "database unavailable", job: "two", role: "worker" }, "Step did not complete"],
    [{ err: "plain failure", job: "four", role: "worker" }, "Step did not complete"],
  ]);
});

test("startScheduler registers the role's timers through the injected clock and stopScheduler clears them all", () => {
  const every = [],
    cleared = [],
    crons = [];
  let stopped = 0;
  const timers = {
    every: (fn, ms) => {
      const handle = { fn, ms };
      every.push(handle);
      return handle;
    },
    clear: (handle) => cleared.push(handle),
    schedule: (expression, fn, options) => {
      crons.push({ expression, fn, options });
      return {
        stop: () => {
          stopped += 1;
        },
      };
    },
  };
  let started;
  try {
    started = startScheduler(WORKER, timers);
    assert.deepEqual(started, names(periodicJobs));
    assert.deepEqual(
      every.map((handle) => handle.ms),
      [60_000, 30_000, 60_000, config.JOB_WORKER_INTERVAL_MS, 60_000, 60_000, 300_000],
    );
    assert.deepEqual(
      crons.map((entry) => [entry.expression, entry.options.timezone]),
      [[dailyCronExpression(), config.CRON_TZ]],
    );
    assert.deepEqual(
      activeJobs().map((job) => [job.name, job.kind]),
      periodicJobs.map((job) => [job.name, job.cron ? "cron" : "interval"]),
    );
    for (const handle of every) assert.equal(typeof handle.fn, "function");
  } finally {
    stopScheduler();
  }
  assert.deepEqual(cleared, every);
  assert.equal(stopped, 1);
  assert.deepEqual(activeJobs(), []);
});
