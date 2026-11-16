import test from 'node:test';
import assert from 'node:assert/strict';
import { demoMigration } from '../src/demo-migration.js';
import { demoImportJobs } from '../src/demo-import-jobs.js';

const invoke = (service, base, suffix = '', body) => service(new URL(`${base}${suffix}`, 'https://fixture.invalid'), body ? { method: 'POST', body: JSON.stringify(body) } : {});
const small = (suffix, body) => invoke(demoMigration, '/api/admin/customer-migrations', suffix, body);
const large = (suffix, body) => invoke(demoImportJobs, '/api/admin/customer-import-jobs', suffix, body);
const payload = (phones, existing_policy = 'skip') => ({
  csv: `Teléfono,Nombre,Saldo\n${phones.map(phone => `${phone},Cliente sintético,20`).join('\n')}`,
  columns: { phone: 'Teléfono', name: 'Nombre', points: 'Saldo' }, existing_policy,
});
const confirmed = body => ({ ...body, label: 'Importación sintética', request_id: crypto.randomUUID(), confirmed: true });

test('normal and background demo imports share duplicate detection and preserve existing balances', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  small('/commit', confirmed(payload(['55550981'])));
  const input = payload(['55550981', '55550982']);
  const preview = large('/preview', input);
  assert.equal(preview.summary.existing_customers, 1);
  assert.equal(preview.summary.new_customers, 1);
  assert.equal(preview.summary.opening_points, 20);
  assert.equal(large('/preview', { ...input, existing_policy: 'reject' }).can_commit, false);
  const request = confirmed(input), queued = large('', request);
  t.mock.timers.tick(1200);
  const job = large().jobs.find(job => job.id === queued.job.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.imported, 1);
  assert.equal(job.skipped, 1);
  assert.equal(job.opening_points, 20);
  assert.equal(small('/preview', payload(['55550982'])).summary.existing_customers, 1);
  assert.equal(large('/preview', input).summary.opening_points, 0);
  assert.equal(large('', request).job.id, job.id);
});

test('background demo import rechecks duplicates when its queued work executes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const input = payload(['55550983']);
  const queued = large('', confirmed(input));
  small('/commit', confirmed(input));
  t.mock.timers.tick(1200);
  const job = large().jobs.find(job => job.id === queued.job.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.imported, 0);
  assert.equal(job.skipped, 1);
  assert.equal(job.opening_points, 0);
});

test('reject and cancellation do not create synthetic customers after queueing', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const input = payload(['55550984'], 'reject');
  const queued = large('', confirmed(input));
  small('/commit', confirmed(input));
  const cancelled = large('', confirmed(payload(['55550985'])));
  large(`/${cancelled.job.id}/cancel`, {});
  t.mock.timers.tick(1200);
  const jobs = large().jobs;
  assert.equal(jobs.find(job => job.id === queued.job.id).status, 'failed');
  assert.equal(jobs.find(job => job.id === queued.job.id).opening_points, 0);
  assert.equal(jobs.find(job => job.id === cancelled.job.id).status, 'cancelled');
  assert.equal(small('/preview', payload(['55550985'])).summary.new_customers, 1);
  assert.equal(large(`/${queued.job.id}/retry`, {}).job.status, 'queued');
  t.mock.timers.tick(1200);
  assert.equal(large().jobs.find(job => job.id === queued.job.id).status, 'failed');
  assert.throws(() => large(`/${cancelled.job.id}/retry`, {}), /lote fallido/);
});
