import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runChurnOnce } from '../../src/app/services/churn-service.js';
import * as lifecycle from '../../src/app/services/lifecycle-service.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('legacy churn delegates to saved guided winback settings without sending directly', async () => {
  const calls = [];
  const now = new Date('2026-11-10T15:00:00Z');
  const result = await runChurnOnce({ businessId: 'business-a', days: 1, now }, {
    context: async (context, fn) => { calls.push({ context }); return fn(); },
    runRule: async input => { calls.push({ input }); return { queued: 2, awarded: 2, points: 40, sent: 0 }; }
  });
  assert.deepEqual(calls, [
    { context: { tenantId: 'business-a', platformAdmin: false } },
    { input: { businessId: 'business-a', rule: 'winback', now } }
  ]);
  assert.deepEqual(result, { queued: 2, awarded: 2, points: 40, sent: 0, failed: 0, suppressed: 0 });
});

it('legacy churn preserves inactive and outside-hour decisions instead of overriding them', async () => {
  for (const reason of ['inactive', 'outside_scheduled_hour', 'budget_requires_configuration']) {
    const result = await runChurnOnce({ businessId: 'business-a', days: 1 }, {
      context: async (_context, fn) => fn(),
      runRule: async () => ({ queued: 0, awarded: 0, points: 0, sent: 0, reason })
    });
    assert.equal(result.reason, reason);
    assert.equal(result.sent, 0);
    assert.equal(result.queued, 0);
  }
});

function maintenanceFixture() {
  const calls = [], warnings = [];
  const dependencies = {
    context: async (context, fn) => { calls.push(['context', context]); return fn(); },
    listBusinessIds: async () => ['one', 'two'],
    getBusiness: async businessId => ({ id: businessId, program_json: { lifecycle: { scheduler_hour_local: 25, scheduler_tz: 'invalid/timezone', suspicious_digest_enabled: true }, tier_policy: { mode: 'rolling' } } }),
    birthday: /** @type {(bid: string) => Promise<{reason?: string, queued?: number}>} */ (async bid => { calls.push(['birthday', bid]); return { reason: 'outside_scheduled_hour' }; }),
    winback: async bid => { calls.push(['winback', bid]); return { reason: 'outside_scheduled_hour' }; },
    digest: async (business, cfg) => { calls.push(['digest', business.id, cfg.suspicious_digest_enabled]); return { sent: false }; },
    retention: async (bid, cfg) => { calls.push(['retention', bid, cfg.mode]); return { checked: 1 }; },
    expiration: async bid => { calls.push(['expiration', bid]); return { expired: 1 }; },
    log: { warn: (...args) => warnings.push(args) }
  };
  return { calls, warnings, dependencies };
}

it('automation scheduling never skips independent expiration, retention or digest maintenance', async () => {
  const { calls, dependencies } = maintenanceFixture();
  // A different valid local hour previously skipped every maintenance step.
  const currentHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Guatemala', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  dependencies.getBusiness = async id => ({ id, program_json: { lifecycle: { scheduler_hour_local: (currentHour + 1) % 24, scheduler_tz: 'America/Guatemala', suspicious_digest_enabled: true }, tier_policy: { mode: 'rolling' } } });
  const result = await lifecycle.runLifecycleOnce({ businessId: 'one' }, dependencies);
  assert.deepEqual(calls.filter(([type]) => type !== 'context').map(([type]) => type), ['birthday', 'winback', 'digest', 'retention', 'expiration']);
  assert.equal(result[0].birthday.reason, 'outside_scheduled_hour');
  assert.deepEqual(result[0].expiration, { expired: 1 });
});

it('one failed lifecycle rule cannot block maintenance or another tenant and logs contain no exception details', async () => {
  const { calls, warnings, dependencies } = maintenanceFixture();
  dependencies.birthday = async bid => { if (bid === 'one') throw new Error('private customer phone +50255551234'); return { queued: 1 }; };
  dependencies.retention = async bid => { if (bid === 'one') throw new Error('private retention detail'); return { checked: 1 }; };
  const result = await lifecycle.runLifecycleOnce({}, dependencies);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].birthday, { error: 'LIFECYCLE_STEP_FAILED' });
  assert.deepEqual(result[0].tierRetention, { error: 'LIFECYCLE_STEP_FAILED' });
  assert.ok(calls.some(([type, bid]) => type === 'expiration' && bid === 'one'));
  assert.ok(calls.some(([type, bid]) => type === 'expiration' && bid === 'two'));
  assert.equal(result[1].birthday.queued, 1);
  assert.equal(warnings.length, 2);
  assert.doesNotMatch(JSON.stringify(warnings), /55551234|private/);
});

it('a failed tenant lookup does not prevent later tenant maintenance', async () => {
  const { calls, warnings, dependencies } = maintenanceFixture();
  const getBusiness = dependencies.getBusiness;
  dependencies.getBusiness = async id => { if (id === 'one') throw new Error('private SQL value'); return getBusiness(id); };
  const result = await lifecycle.runLifecycleOnce({}, dependencies);
  assert.deepEqual(result[0], { businessId: 'one', error: 'LIFECYCLE_BUSINESS_FAILED' });
  assert.ok(calls.some(([type, bid]) => type === 'expiration' && bid === 'two'));
  assert.doesNotMatch(JSON.stringify(warnings), /private/);
});

it('marketing ticks continue dispatch stages when generation or automation dispatch fails', async () => {
  assert.equal(typeof lifecycle.createMarketingTick, 'function');
  const calls = [], warnings = [];
  const tick = lifecycle.createMarketingTick({
    generate: async () => { calls.push('generate'); throw new Error('private generation detail'); },
    dispatchAutomations: async () => { calls.push('automations'); throw new Error('private provider detail'); },
    dispatchCampaigns: async () => { calls.push('campaigns'); return { accepted: 1 }; },
    log: { warn: (...args) => warnings.push(args) }
  });
  await tick();
  await tick();
  assert.deepEqual(calls, ['generate', 'automations', 'campaigns', 'generate', 'automations', 'campaigns']);
  assert.equal(warnings.length, 4);
  assert.doesNotMatch(JSON.stringify(warnings), /private/);
});

it('marketing ticks do not overlap within a process and release the guard after finishing', async () => {
  assert.equal(typeof lifecycle.createMarketingTick, 'function');
  let release = () => {}, started = () => {}, generations = 0, campaigns = 0;
  const ready = new Promise(resolve => { started = () => resolve(null); });
  const pending = new Promise(resolve => { release = () => resolve(null); });
  const tick = lifecycle.createMarketingTick({
    generate: async () => { generations++; started(); await pending; },
    dispatchAutomations: async () => ({}),
    dispatchCampaigns: async () => { campaigns++; },
    log: { warn: () => {} }
  });
  const first = tick(); await ready;
  assert.deepEqual(await tick(), { skipped: true });
  assert.equal(generations, 1);
  release(); await first; await tick();
  assert.equal(generations, 2); assert.equal(campaigns, 2);
});

it('API and standalone entrypoints schedule the same guarded dispatch and clear timers on shutdown', async () => {
  await promisify(execFile)(process.execPath, [
    '--experimental-vm-modules',
    fileURLToPath(new URL('../fixtures/automation-entrypoints-harness.mjs', import.meta.url))
  ], { env: { ...process.env, NODE_ENV: 'test' }, timeout: 15_000 });
});
