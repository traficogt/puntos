import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatusSnapshot } from '../../deploy/status/snapshot-model.mjs';
const now = '2026-11-16T12:00:00Z';
const history = { sitio: { status: 'up', lastUpdated: now, startTime: now, private: 'never' } };
test('a failed monitor cannot silently re-publish a successful prior observation', () => {
  assert.equal(buildStatusSnapshot({ histories: history, now }).components[0].state, 'unknown');
  const result = buildStatusSnapshot({ histories: history, now, monitorSucceeded: true });
  assert.equal(result.components[0].state, 'up');
  assert.equal(result.components[1].state, 'unknown');
  assert.equal(JSON.stringify(result).includes('never'), false);
});
test('public users cannot spoof incidents or incident updates', () => {
  const issue = { number: 1, title: 'Incidencia', body: '<!-- private metadata -->\nServicio lento', html_url: 'https://github.com/traficogt/puntos-estado/issues/1', state: 'open', labels: [{ name: 'status' }], author_association: 'MEMBER', created_at: now };
  const fake = { ...issue, number: 2, author_association: 'NONE' };
  const result = buildStatusSnapshot({ now, issues: [issue, fake], comments: { 1: [{ body: 'spoof', author_association: 'NONE' }, { body: 'Investigando', author_association: 'OWNER', created_at: now }] }, incidentFeedAvailable: true });
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].body, 'Servicio lento');
  assert.deepEqual(result.incidents[0].updates, [{ body: 'Investigando', at: now }]);
  assert.equal(result.incidentsCheckedAt, now);
});
test('maintenance and closed incidents retain their real timestamps', () => {
  const issue = { number: 2, html_url: 'https://github.com/traficogt/puntos-estado/issues/2', user: { login: 'github-actions[bot]' }, state: 'closed', labels: [{ name: 'maintenance' }], created_at: now, closed_at: now };
  const result = buildStatusSnapshot({ now, issues: [issue] });
  assert.equal(result.incidents[0].maintenance, true);
  assert.equal(result.incidents[0].closedAt, now);
  assert.equal(result.incidentsCheckedAt, null);
});
