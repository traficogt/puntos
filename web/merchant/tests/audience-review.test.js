import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audiencePresets, validateAudience } from '../src/audience-model.js';
import { demoAudiences, demoAudiencePreview, demoAudienceSnapshot } from '../src/demo-audiences.js';
import { demoGrowth } from '../src/demo-growth.js';

const invoke = (suffix, body, method = 'POST') => demoAudiences(new URL(`https://fixture.invalid/api/admin/audiences${suffix}`), { method, body: JSON.stringify(body) });
const create = (definition = audiencePresets.frequent.definition()) => invoke('', { name: 'Audiencia de revisión', definition, request_id: crypto.randomUUID() }).segment;

test('demo previews use coherent period purchases and retain all-time purchase history', () => {
  const definition = { ...audiencePresets.frequent.definition(), window_days: 30, include: { match: 'all', rules: [{ field: 'has_purchase', operator: 'eq', value: true }] } };
  const preview = demoAudiencePreview(definition, 20);
  for (const row of preview.customers) {
    assert.equal(row.purchase_count === 0, row.spend_q === 0, row.id);
    if (row.last_purchase_days > 30) assert.equal(row.purchase_count, 0, row.id);
  }
  assert.ok(preview.customers.some(row => row.has_purchase && row.purchase_count === 0));
  assert.ok(preview.contactable_count <= preview.total);
  assert.ok(preview.customers.every(row => !('phone' in row)));
});

test('demo snapshots match the persisted campaign contract and remain immutable across segment edits', () => {
  const segment = create();
  const result = demoAudienceSnapshot(segment.id, segment.version, 10);
  assert.equal(result.snapshot.total, demoAudiencePreview(segment.definition).total);
  assert.equal(result.snapshot.limit, 10);
  assert.equal(result.snapshot.selected_count, result.member_count);
  assert.equal(result.snapshot.overflow_count, result.snapshot.total - result.member_count);
  assert.equal(typeof result.snapshot.cutoff, 'string');
  const original = structuredClone(result.snapshot);
  invoke(`/${segment.id}`, { name: 'Nueva versión', definition: audiencePresets.new.definition(), version: segment.version, archived: false }, 'PUT');
  assert.deepEqual(result.snapshot, original);
  assert.throws(() => demoAudienceSnapshot(segment.id, segment.version, 10), { status: 409 });
});

test('demo archive and restore preserve version checks and existing campaign snapshots', () => {
  const segment = create(), payload = { request_id: crypto.randomUUID(), name: 'Oferta de revisión', audience_segment_id: segment.id, audience_segment_version: segment.version, audience_limit: 10, bonus_points: 5, minimum_purchase_q: 10, duration_days: 14, holdout_percent: 20 };
  const url = new URL('https://fixture.invalid/api/admin/growth-campaigns');
  const first = structuredClone(demoGrowth(url, { method: 'POST', body: JSON.stringify(payload) }));
  const archived = invoke(`/${segment.id}`, { name: segment.name, definition: segment.definition, version: 1, archived: true }, 'PUT').segment;
  assert.equal(archived.version, 2);
  assert.throws(() => demoAudienceSnapshot(segment.id, archived.version, 10), { status: 409 });
  assert.deepEqual(demoGrowth(url, { method: 'POST', body: JSON.stringify(payload) }), first);
  const restored = invoke(`/${segment.id}`, { name: segment.name, definition: segment.definition, version: 2, archived: false }, 'PUT').segment;
  assert.equal(restored.version, 3);
  assert.throws(() => demoAudienceSnapshot(segment.id, 2, 10), { status: 409 });
  assert.equal(demoAudienceSnapshot(segment.id, 3, 10).snapshot.segment_version, 3);
});

test('malformed rule input returns a validation message instead of crashing the editor', () => {
  const definition = audiencePresets.frequent.definition();
  definition.include.rules = [null];
  assert.equal(typeof validateAudience(definition), 'string');
});
