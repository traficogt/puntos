import assert from 'node:assert/strict';
import { it } from 'node:test';
import { awardFromExternalEventWithDeps } from '../../src/app/services/external-award-service.js';
import { awardPointsWithDeps } from '../../src/app/services/staff-award-service.js';
import { computePoints, computePointsWithEvidence } from '../../src/app/services/points-service.js';
import { AuditRepo } from '../../src/app/repositories/audit-repository.js';

for (const writer of ['staff', 'external']) for (const withCriteria of [false,true]) it(`${writer} ${withCriteria ? 'with captured targeted terms' : 'with unknown targeted terms'} persists the exact evaluated rules and bonus, overwrites untrusted evidence and preserves retries`, async t => {
  t.mock.method(AuditRepo, 'log', async () => {});
  /** @type {any} */
  let row;
  const business = { id: 'business', plan: 'EMPRESA', program_type: 'SPEND', program_json: { points_per_q: 0.5, external_awards: { enabled: true, api_key: 'private' } } };
  const client = { query: async (sql, params) => {
    if (sql.includes('FROM transactions') && (sql.includes('meta->>') || sql.includes('WHERE id=$1'))) return { rows: row ? [row] : [] };
    if (sql.includes('SELECT id FROM customers')) return { rows: [{ id: 'customer' }] };
    if (sql.includes('INSERT INTO transactions')) {
      row = writer === 'external'
        ? { id: params[0], business_id: params[1], customer_id: params[2], amount_q: params[3], visits: params[4], items: params[5], points: params[6], status: params[7], available_at: params[8], meta: params[9] }
        : { id: params[0], business_id: params[1], customer_id: params[3], staff_user_id: params[4], amount_q: params[5], visits: params[6], items: params[7], points: params[8], status: params[9], available_at: params[10], meta: params[12] };
    }
    return { rows: sql.includes('customer_balances') ? [{ points: 10, pending_points: 0 }] : [], rowCount: 1 };
  } };
  const deps = {
    computePoints, computePointsWithEvidence, withTransaction: async fn => fn(client), setCurrentTenant: async () => {},
    BusinessRepo: { getPublicBySlug: async () => business, getById: async () => business, activeCustomerCount: async () => 0 },
    CustomerRepo: { getById: async () => ({ id: 'customer', business_id: 'business' }) },
    timingSafeEqualString: (a,b) => a === b, planLimits: () => ({ activeCustomers: 100 }),
    verifyQrToken: async () => ({ bid: 'business', cid: 'customer', jti: 'qr', exp: 9999999999 }),
    claimTargetedOffer: async () => ({ bonusPoints: 5, campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    enqueueWebhookEvent: async () => {}, isSourceTransactionActive: async () => false
  };
  const criteria = { schema_version:1,clock:'database',evaluated_at:'2026-11-11T18:00:00.000001Z',minimum_purchase_q:5,
    starts_at:'2026-11-11T00:00:00.000000Z',expires_at:'2026-11-12T00:00:00.000000Z',points_budget:10,points_committed_before:0,points_committed_after:5,
    eligibility:{campaign_active:true,saved_membership:'treatment',unclaimed_before_award:true,customer_not_deleted:true,program_enabled_at_request:true,plan_features_allowed:true},
    purchase:{amount_q:10,visits:0,items:0,source:writer==='staff'?'offline':'external'},private:'PRIVATE_TERMS'};
  if(withCriteria)deps.claimTargetedOffer=async()=>({bonusPoints:5,campaignId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',criteria});
  const args = { businessSlug: 'fixture', apiKey: 'private', externalEventId: 'fixture-event', customerId: 'customer',
    staff: { id: 'staff', business_id: 'business' }, customerQrToken: 'fixture', txId: 'transaction',
    source: 'offline', amount_q: 10, meta: { award_evidence: { forged: true }, client_ts: '2001-01-01T00:00:00Z' } };
  const award = writer === 'external' ? awardFromExternalEventWithDeps : awardPointsWithDeps;
  const result = await award(deps, args);
  assert.equal(result.pointsAwarded, 10);
  assert.equal(row.meta.award_evidence.program_points, 5, 'persist evidence produced during computation');
  assert.equal(row.meta.award_evidence.awarded_points, 10);
  assert.equal(row.meta.award_evidence.targeted_offer.bonus_points, 5);
  if(withCriteria){ assert.equal(row.meta.award_evidence.targeted_offer.criteria.minimum_purchase_q,5); assert.equal(row.meta.award_evidence.targeted_offer.criteria.private,undefined); criteria.minimum_purchase_q=999; assert.equal(row.meta.award_evidence.targeted_offer.criteria.minimum_purchase_q,5); }
  else assert.equal(row.meta.award_evidence.targeted_offer.criteria, 'not_snapshotted');
  assert.equal(row.meta.award_evidence.forged, undefined);
  assert.ok(Date.parse(row.meta.award_evidence.evaluated_at) > Date.parse('2026-01-01'));
  if (writer === 'staff') assert.equal(row.meta.award_evidence.offline_capture.clock, 'client_reported');
  const snapshot = structuredClone(row.meta.award_evidence);
  business.program_json.points_per_q = 99;
  const replay = await award(deps, args);
  assert.equal(replay.replay, true);
  assert.equal(replay.pointsAwarded, 10);
  assert.deepEqual(row.meta.award_evidence, snapshot);
});
