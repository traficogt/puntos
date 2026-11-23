// Execute unchanged bootstrap modules with timer/network/database boundaries
// replaced. No listeners, database connections, provider requests or real timers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import { createMarketingTick } from "../../src/app/services/lifecycle-service.js";

// Modules evaluated from their real source inside the sandbox instead of mocked:
// the shared job registry is the wiring under test.
const REAL_MODULES = new Set(["./scheduler.js"]);
const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g;

function importedNames(clause) {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{")) return ["default"];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function verifyEntrypoint(filename, enabled) {
  const intervals = [],
    cleared = [],
    cronJobs = [],
    calls = [],
    warnings = [],
    exits = [];
  const signals = new Map();
  let listening = false,
    marketingTick,
    cronStopped = false;
  const nothing = async () => {};
  const logger = {
    info() {},
    warn(...args) {
      warnings.push(args);
    },
    fatal(...args) {
      warnings.push(args);
    },
  };
  const app = {
    set() {},
    use() {},
    get() {},
    listen() {
      listening = true;
      return {
        close(fn) {
          fn();
        },
      };
    },
  };
  const express = Object.assign(() => app, { json() {}, static() {} });
  const cron = {
    schedule: (expression, callback, options) => {
      cronJobs.push({ expression, callback, options });
      return {
        stop() {
          cronStopped = true;
        },
      };
    },
  };
  const defaultExports = { express, "node:path": path, "node-cron": cron };
  const exportsByName = {
    logger,
    httpLogOptions: {},
    config: {
      NODE_ENV: "production",
      // The production default is off; only an explicit true enables the API share.
      IN_PROCESS_WORKERS: enabled === true,
      CHURN_SEND_HOUR_LOCAL: 9,
      CRON_TZ: "America/Guatemala",
      JOB_WORKER_INTERVAL_MS: 5000,
      JOB_WORKER_BATCH_SIZE: 10,
      LEDGER_RECONCILE_LIMIT: 100,
      LEDGER_RECONCILE_REPAIR: false,
    },
    withDbClientContext: async (_context, fn) => fn(),
    WebhookRepo: { encryptPlaintextSecrets: nothing, rotateSecretsToCurrentKey: nothing },
    BusinessRepo: { rotateExternalAwardApiKeysToCurrent: nothing, listAllIds: async () => [] },
    createMarketingTick: () => {
      marketingTick = createMarketingTick({
        generate: async () => {
          calls.push("generate");
          throw new Error("private generation fixture");
        },
        dispatchAutomations: async () => {
          calls.push("automations");
          throw new Error("private dispatch fixture");
        },
        dispatchCampaigns: async () => {
          calls.push("campaigns");
        },
        log: logger,
      });
      return marketingTick;
    },
    runLifecycleOnce: async () => {
      calls.push("maintenance");
      throw new Error("private maintenance fixture");
    },
    runLedgerReconciliation: async () => {
      calls.push("ledger");
      return { mismatchedCustomers: 0 };
    },
    resolveCertificationPeriod: () => ({ from: "2026-11-01", to: "2026-11-10" }),
  };
  const context = createContext({
    process: {
      env: {},
      cwd: () => "/tmp",
      on: (signal, callback) => signals.set(signal, callback),
      exit: (code) => exits.push(code),
    },
    setInterval: (callback, delay) => {
      const timer = { callback, delay };
      intervals.push(timer);
      return timer;
    },
    clearInterval: (timer) => cleared.push(timer),
    setTimeout: () => ({ unref() {} }),
    URL,
  });

  // Collect the imports of the entrypoint and of every real module it pulls in,
  // so one synthetic module per specifier exports the union of imported names.
  const sources = new Map();
  const mockedNames = new Map();
  async function collect(file) {
    // Only fixed repository filenames reach this fixture.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const source = await readFile(new URL(`../../src/app/${file}`, import.meta.url), "utf8");
    sources.set(`./${file}`, source);
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[2];
      if (REAL_MODULES.has(specifier)) {
        if (!sources.has(specifier)) await collect(specifier.slice(2));
        continue;
      }
      const names = mockedNames.get(specifier) ?? new Set();
      for (const name of importedNames(match[1])) names.add(name);
      mockedNames.set(specifier, names);
    }
  }
  await collect(filename);

  const modules = new Map();
  for (const [specifier, nameSet] of mockedNames) {
    const names = [...nameSet];
    const values = Object.fromEntries(
      names.map((name) => [
        name,
        name === "default"
          ? (defaultExports[specifier] ?? nothing)
          : (exportsByName[name] ?? nothing),
      ]),
    );
    modules.set(
      specifier,
      new SyntheticModule(
        names,
        function () {
          for (const name of names) this.setExport(name, values[name]);
        },
        { context },
      ),
    );
  }
  for (const [specifier, source] of sources) {
    modules.set(
      specifier,
      new SourceTextModule(source, { context, identifier: specifier.slice(2) }),
    );
  }
  const entrypoint = modules.get(`./${filename}`);
  await entrypoint.link((specifier) => {
    const dependency = modules.get(specifier);
    assert.ok(dependency, `Unmocked import: ${specifier}`);
    return dependency;
  });
  await entrypoint.evaluate();
  const scheduler = modules.get("./scheduler.js")?.namespace;
  assert.ok(scheduler, `${filename} must schedule through the shared job registry`);

  for (let attempt = 0; !listening && attempt < 20; attempt++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(listening, `${filename} did not finish bootstrap: ${JSON.stringify(warnings)}`);
  assert.deepEqual(exits, []);
  const marketingHandle = scheduler
    .activeJobs()
    .find((job) => job.name === "marketing.tick")?.handle;
  const marketing = intervals.filter((timer) => timer === marketingHandle);
  if (filename === "server.js" && enabled !== true) {
    assert.equal(
      intervals.length,
      0,
      "API jobs must stay disabled in production unless explicitly enabled",
    );
    assert.equal(cronJobs.length, 0);
    assert.equal(scheduler.activeJobs().length, 0);
  } else {
    assert.equal(marketing.length, 1, `${filename} must schedule the guided outboxes exactly once`);
    assert.equal(marketing[0].delay, 60_000);
    await marketing[0].callback();
    assert.deepEqual(calls, ["generate", "automations", "campaigns"]);
    assert.equal(cronJobs.length, 1);
    assert.equal(cronJobs[0].expression, "0 09 * * *");
    assert.equal(cronJobs[0].options.timezone, "America/Guatemala");
    const warningsBeforeDaily = warnings.length;
    await cronJobs[0].callback();
    assert.equal(calls[3], "maintenance");
    if (filename === "worker.js")
      assert.equal(calls[4], "ledger", "Daily maintenance errors must not block ledger checks");
    // Marketing stages keep hiding exception details (lifecycle-service contract)...
    assert.doesNotMatch(JSON.stringify(warnings.slice(0, warningsBeforeDaily)), /private/);
    // ...while a failed daily step is reported with its error attached, not swallowed.
    const dailyFailure = warnings
      .slice(warningsBeforeDaily)
      .find(([context]) => context?.job === "lifecycle.daily");
    assert.ok(dailyFailure, `${filename} must log the failed daily maintenance step`);
    assert.equal(dailyFailure[0].err, "private maintenance fixture");
  }
  signals.get("SIGTERM")();
  assert.equal(cleared.length, intervals.length);
  if (marketing.length) {
    assert.ok(cleared.includes(marketing[0]));
    assert.equal(cronStopped, true);
  }
  // Arrays cross the sandbox realm, so compare the length rather than the prototype.
  assert.equal(scheduler.activeJobs().length, 0, "shutdown must release every registered job");
}

await verifyEntrypoint("server.js", true);
await verifyEntrypoint("server.js", false);
await verifyEntrypoint("server.js", undefined);
await verifyEntrypoint("worker.js", undefined);
