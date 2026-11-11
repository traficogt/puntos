import assert from 'node:assert/strict';
import test from 'node:test';
import {buildDecisions} from '../../src/app/services/merchant-decisions-model.js';
const load = () => import('../../src/app/services/owner-outcome-model.js');
const sample = {
  as_of: '2026-11-11T18:00:00Z', region: { currency: 'GTQ', locale: 'es-GT', timezone: 'America/Guatemala' },
  period: { days: 30, start: '2026-10-12T18:00:00Z', end: '2026-11-11T18:00:00Z' },
  costs: { active: 4, missing: 1 }, hospitality: { total: 8, fulfilled: 5, expired_unused: 3, reserved_unused: 15 },
  returns: { cohort: { start: '2026-08-14T06:00:00Z', end: '2026-11-11T18:00:00Z' }, completed: { customers: 10, returned_customers: 4, without_return_customers: 6, return_rate_pct: 40 }, ongoing: { customers: 5, returned_customers: 1 } }
};
test('outcomes provide counts, bounded scope and useful owner actions without claims of lift', async () => {
  const { ownerOutcomeFindings } = await load(); const rows = ownerOutcomeFindings(sample);
  assert.deepEqual(rows.map(r => r.key), ['operation-economics', 'hospitality-unused', 'redemption-follow-up']);
  assert.match(rows[0].explanation, /1 de 4/); assert.match(rows[1].explanation, /3 de 8/); assert.match(rows[1].explanation, /reservado/);
  assert.match(rows[2].explanation, /4 de 10/); assert.match(rows[2].explanation, /5.*seguimiento/);
  assert.equal(rows[2].action.href, '?ver=visitas-tras-canje#resumen');
  assert.ok(rows.every(r => r.observed_at === sample.as_of));
});
test('empty observations produce no invented alert and ongoing-only returns have no result finding', async () => {
  const { ownerOutcomeFindings } = await load();
  assert.deepEqual(ownerOutcomeFindings({ ...sample, costs: { active: 1, missing: 0 }, hospitality: { total: 0, expired_unused: 0 }, returns: { ...sample.returns, completed: { customers: 0 } } }), []);
  assert.equal(ownerOutcomeFindings({ ...sample, returns: null }).some(r => r.key === 'redemption-follow-up'), false);
});
test('request timestamps do not change review evidence, substantive counts do', async () => {
  const { ownerOutcomeFindings } = await load(); const later = structuredClone(sample);
  later.as_of = '2026-11-11T18:01:00Z'; later.period.start = '2026-10-12T18:01:00Z'; later.period.end = later.as_of; later.returns.cohort.end = later.as_of;
  assert.deepEqual(ownerOutcomeFindings(sample).map(r => r.evidence), ownerOutcomeFindings(later).map(r => r.evidence));
  later.hospitality.expired_unused = 4;
  assert.notDeepEqual(ownerOutcomeFindings(sample)[1].evidence, ownerOutcomeFindings(later)[1].evidence);
});
test('weekly findings keep urgent issues first, limit three and report omitted observations', async () => {
  const { selectWeeklyFindings } = await load();
  const all = [{ key: 'recorded_activity', priority: 90 }, { key: 'redemption-follow-up', priority: 40 }, { key: 'data_quality', priority: 1 }, { key: 'delivery_quality', priority: 10 }, { key: 'operation-economics', priority: 20 }];
  const selected = selectWeeklyFindings(all);
  assert.deepEqual(selected.findings.map(r => r.key), ['data_quality', 'delivery_quality', 'operation-economics']);
  assert.equal(selected.additional_count, 2); assert.equal(selectWeeklyFindings([]).findings.length, 0);
});

test('a new local day preserves reviewed and snoozed decisions when substantive observations are unchanged', async () => {
 const {ownerOutcomeFindings}=await load();const first=buildDecisions({outcomes:ownerOutcomeFindings(sample),now:new Date(sample.as_of)});
 const later=structuredClone(sample);later.as_of='2026-11-12T18:00:00Z';later.period={days:30,start:'2026-10-13T18:00:00Z',end:later.as_of};later.returns.cohort={start:'2026-08-15T06:00:00Z',end:later.as_of};
 const reviews=first.map(x=>({decision_key:x.key,evidence_fingerprint:x.fingerprint,status:x.key==='hospitality-unused'?'snoozed':'reviewed',snoozed_until:'2026-11-13T18:00:00Z',version:1}));
 const next=buildDecisions({outcomes:ownerOutcomeFindings(later),reviews,now:new Date(later.as_of)});
 assert.equal(next.find(x=>x.key==='hospitality-unused').review_state,'snoozed');assert.equal(next.find(x=>x.key==='redemption-follow-up').review_state,'reviewed');assert.equal(next.find(x=>x.key==='redemption-follow-up').period.end,later.as_of);
});
