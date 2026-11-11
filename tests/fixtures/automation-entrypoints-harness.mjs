// Execute unchanged bootstrap modules with timer/network/database boundaries
// replaced. No listeners, database connections, provider requests or real timers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { createMarketingTick } from '../../src/app/services/lifecycle-service.js';

async function verifyEntrypoint(filename, enabled) {
  // The two entrypoint filenames below are fixed by this fixture.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = await readFile(new URL(`../../src/app/${filename}`, import.meta.url), 'utf8');
  const intervals = [], cleared = [], cronJobs = [], calls = [], warnings = [], exits = [];
  const signals = new Map();
  let listening = false, marketingTick, cronStopped = false;
  const nothing = async () => {};
  const logger = { info() {}, warn(...args) { warnings.push(args); }, fatal(...args) { warnings.push(args); } };
  const app = { set() {}, use() {}, get() {}, listen() { listening = true; return { close(fn) { fn(); } }; } };
  const express = Object.assign(() => app, { json() {}, static() {} });
  const exportsByName = {
    logger, httpLogOptions: {},
    config: { NODE_ENV: 'production', CHURN_SEND_HOUR_LOCAL: 9, CRON_TZ: 'America/Guatemala', JOB_WORKER_INTERVAL_MS: 5000 },
    withDbClientContext: async (_context, fn) => fn(),
    WebhookRepo: { encryptPlaintextSecrets: nothing, rotateSecretsToCurrentKey: nothing },
    BusinessRepo: { rotateExternalAwardApiKeysToCurrent: nothing, listAllIds: async () => [] },
    createMarketingTick: () => {
      marketingTick = createMarketingTick({
        generate: async () => { calls.push('generate'); throw new Error('private generation fixture'); },
        dispatchAutomations: async () => { calls.push('automations'); throw new Error('private dispatch fixture'); },
        dispatchCampaigns: async () => { calls.push('campaigns'); },
        log: logger
      });
      return marketingTick;
    },
    runLifecycleOnce: async () => { calls.push('maintenance'); throw new Error('private maintenance fixture'); },
    runLedgerReconciliation: async () => { calls.push('ledger'); return { mismatchedCustomers: 0 }; },
    resolveCertificationPeriod: () => ({ from: '2026-11-01', to: '2026-11-10' })
  };
  const context = createContext({
    process: { env: enabled === undefined ? {} : { IN_PROCESS_WORKERS: String(enabled) }, cwd: () => '/tmp', on: (signal, callback) => signals.set(signal, callback), exit: code => exits.push(code) },
    setInterval: (callback, delay) => { const timer = { callback, delay }; intervals.push(timer); return timer; },
    clearInterval: timer => cleared.push(timer),
    setTimeout: () => ({ unref() {} }),
    URL
  });
  const imports = new Map();
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g)) {
    const specifier = match[2], clause = match[1].trim();
    const names = clause.startsWith('{') ? clause.slice(1, -1).split(',').map(x => x.trim()) : ['default'];
    const values = Object.fromEntries(names.map(name => {
      let value = exportsByName[name] ?? nothing;
      if (name === 'default' && specifier === 'express') value = express;
      if (name === 'default' && specifier === 'node:path') value = path;
      if (name === 'default' && specifier === 'node-cron') value = { schedule: (expression, callback, options) => { cronJobs.push({ expression, callback, options }); return { stop() { cronStopped = true; } }; } };
      return [name, value];
    }));
    imports.set(specifier, new SyntheticModule(names, function() {
      for (const name of names) this.setExport(name, values[name]);
    }, { context }));
  }
  const entrypoint = new SourceTextModule(source, { context, identifier: filename });
  await entrypoint.link(specifier => {
    const dependency = imports.get(specifier);
    assert.ok(dependency, `Unmocked import: ${specifier}`);
    return dependency;
  });
  await entrypoint.evaluate();
  for (let attempt = 0; !listening && attempt < 20; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(listening, `${filename} did not finish bootstrap: ${JSON.stringify(warnings)}`);
  assert.deepEqual(exits, []);
  const marketing = intervals.filter(timer => timer.callback === marketingTick);
  if (filename === 'server.js' && enabled !== true) {
    assert.equal(intervals.length, 0, 'API jobs must stay disabled in production unless explicitly enabled');
    assert.equal(cronJobs.length, 0);
  } else {
    assert.equal(marketing.length, 1, `${filename} must schedule the guided outboxes exactly once`);
    assert.equal(marketing[0].delay, 60_000);
    await marketing[0].callback();
    assert.deepEqual(calls, ['generate', 'automations', 'campaigns']);
    assert.equal(cronJobs.length, 1);
    assert.equal(cronJobs[0].expression, '0 09 * * *');
    assert.equal(cronJobs[0].options.timezone, 'America/Guatemala');
    await cronJobs[0].callback();
    assert.equal(calls[3], 'maintenance');
    if (filename === 'worker.js') assert.equal(calls[4], 'ledger', 'Daily maintenance errors must not block ledger checks');
    assert.doesNotMatch(JSON.stringify(warnings), /private/);
  }
  signals.get('SIGTERM')();
  assert.equal(cleared.length, intervals.length);
  if (marketing.length) { assert.ok(cleared.includes(marketing[0])); assert.equal(cronStopped, true); }
}

await verifyEntrypoint('server.js', true);
await verifyEntrypoint('server.js', false);
await verifyEntrypoint('server.js', undefined);
await verifyEntrypoint('worker.js', undefined);
