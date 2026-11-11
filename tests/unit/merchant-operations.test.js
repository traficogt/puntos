import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createMerchantOperationsService } from '../../src/app/services/merchant-operations-service.js';

const now = new Date('2026-11-10T18:00:00Z');
const businessId = 'fixture-business';
function fixture({ business = { id: businessId, plan: 'EMPRESA', program_json: {} }, overrides = {}, messages = {}, lifecycle = {}, refunds = [], economics = {}, wallets = [], readiness = {}, briefs = {}, queryError = null } = {}) {
  const calls = [];
  const service = createMerchantOperationsService({
    getBusiness: async id => { assert.equal(id, businessId); return business; },
    getFeatureOverrides: async () => overrides,
    getProviderReadiness: async () => readiness,
    query: async (sql, args) => {
      calls.push({ sql, args });
      assert.equal(args[0], businessId);
      if (queryError) throw queryError;
      return { rows: sql.includes('weekly_owner_briefs') ? [briefs] : sql.includes('growth_message_outbox') ? [{ source: 'growth', ...messages }, { source: 'lifecycle', ...lifecycle }] : sql.includes('pos_refund_receipts') ? refunds : sql.includes('reward_unit_costs') ? [economics] : wallets };
    }
  });
  return { calls, health: () => service.getOperationsHealth({ businessId, now }) };
}
function section(result, id) { return result.sections.find(value => value.id === id); }
function metrics(value) { return Object.fromEntries(value.metrics.map(item => [item.key, item.value])); }

it('preserves the four existing sections and appends cost coverage and no evidence is not claimed as connected', async () => {
  const result = await fixture().health();
  assert.equal(result.generated_at, now.toISOString());
  assert.deepEqual(result.sections.map(value => value.id), ['pos', 'messaging', 'apple_wallet', 'google_wallet', 'economics', 'owner_brief']);
  for (const value of result.sections) {
    for (const field of ['action', 'id', 'last_observed_at', 'metrics', 'state', 'summary', 'title', 'reasons']) assert.ok(field in value, field);
    assert.equal(value.last_observed_at, null);
    assert.equal(typeof value.action.label, 'string');
    assert.match(value.action.href, /^(#|\/)/);
    assert.equal(value.metrics.every(metric => ['number', 'string'].includes(typeof metric.value) || metric.value === null), true);
  }
  assert.equal(section(result, 'pos').state, 'not_configured');
  for (const id of ['messaging', 'apple_wallet', 'google_wallet']) assert.equal(section(result, id).state, 'unknown');
});

it('redacts locked POS and messaging history on basic plans and respects each entitlement override', async () => {
  for (const { plan, overrides, locked } of [
    { plan: 'EMPRENDEDOR', overrides: {}, locked: ['pos', 'messaging'] },
    { plan: 'NEGOCIO', overrides: { NEGOCIO: { analytics: false } }, locked: ['pos', 'messaging'] },
    { plan: 'EMPRESA', overrides: { EMPRESA: { campaign_rules: false } }, locked: ['messaging'] },
    { plan: 'EMPRESA', overrides: { EMPRESA: { lifecycle_automation: false } }, locked: ['messaging'] },
    { plan: 'EMPRESA', overrides: { EMPRESA: { external_awards: false } }, locked: ['pos'] }
  ]) {
    const f = fixture({ business: { id: businessId, plan, program_json: { pos_integration: { pending_receipts: ['private-receipt'] } } }, overrides });
    const result = await f.health();
    for (const id of locked) {
      assert.equal(section(result, id).state, 'not_in_plan');
      assert.deepEqual(section(result, id).metrics, []);
      assert.equal(section(result, id).last_observed_at, null);
    }
    if (locked.includes('messaging')) assert.equal(f.calls.some(call => call.sql.includes('growth_message_outbox')), false);
  }
});

it('reads feature overrides without inventing a healthy result when settings fail', async () => {
  const error = new Error('settings database unavailable');
  const service = createMerchantOperationsService({ getBusiness: async () => ({ id: businessId, plan: 'EMPRESA' }), getFeatureOverrides: async () => { throw error; } });
  await assert.rejects(service.getOperationsHealth({ businessId, now }), error);
});

it('reports current recorded POS configuration without claiming live connectivity or exposing secrets', async () => {
  const f = fixture({ business: { id: businessId, plan: 'EMPRESA', program_json: {
    external_awards: { enabled: true, api_key: 'secret-api-key' },
    pos_integration: { enabled: true, mode: 'loyverse', automatic: true, connected_at: now.toISOString(), loyverse: { access_token: 'secret-pos-token', merchant_id: 'secret-provider-id' }, last_completed_at: now.toISOString(), last_sync: { at: now.toISOString(), status: 'ok', errors: 0, issues: [{ phone: '+50255550001', message: 'raw-provider-error' }] }, pending_receipts: [] }
  } } });
  const result = await f.health(), pos = section(result, 'pos');
  assert.equal(pos.state, 'configured');
  assert.match(pos.summary, /no confirma.*conexión/i);
  assert.equal(pos.last_observed_at, now.toISOString());
  assert.equal(metrics(pos).last_completed_at, now.toISOString());
  for (const secret of ['secret-api-key', 'secret-pos-token', 'secret-provider-id', '+50255550001', 'raw-provider-error']) assert.equal(JSON.stringify(result).includes(secret), false);
});

it('flags incomplete, failed, pending and stale automatic POS imports even when the latest poll is fresh', async () => {
  for (const patch of [
    { pending_receipts: ['private-receipt'] },
    { last_sync: { at: now.toISOString(), status: 'error', errors: 1 } },
    { last_sync: { at: now.toISOString(), status: 'attention', errors: 0 } },
    { last_sync: { at: now.toISOString(), status: 'ok', has_more: true } },
    { last_completed_at: '2026-11-08T18:00:00Z' }
  ]) {
    const result = await fixture({ business: { id: businessId, plan: 'EMPRESA', program_json: {
      external_awards: { enabled: true, api_key: 'secret' },
      pos_integration: { enabled: true, mode: 'loyverse', automatic: true, connected_at: '2026-11-08T18:00:00Z', loyverse: { access_token: 'secret' }, last_completed_at: now.toISOString(), last_sync: { at: now.toISOString(), status: 'ok' }, ...patch }
    } } }).health();
    assert.equal(section(result, 'pos').state, 'needs_attention', JSON.stringify(patch));
  }
});

it('does not label manual CSV imports stale and never echoes malformed dates or provider fields', async () => {
  const result = await fixture({ business: { id: businessId, plan: 'EMPRESA', program_json: {
    external_awards: { enabled: true }, pos_integration: { enabled: true, mode: 'csv', automatic: false, last_completed_at: '2025-01-01T00:00:00Z', last_sync: { at: 'private-date-error', status: 'ok', provider_reference: 'private-provider' } }
  } } }).health();
  assert.equal(section(result, 'pos').state, 'configured');
  assert.equal(JSON.stringify(result).includes('private-'), false);
});

it('reports accepted messages as acceptance and flags failures, uncertainty and stale backlog', async () => {
  const healthy = section(await fixture({ readiness: { messaging: true }, messages: { total: 4, accepted: 3, suppressed: 1, last_observed_at: now } }).health(), 'messaging');
  assert.equal(healthy.state, 'configured');
  assert.equal(metrics(healthy).accepted, 3);
  assert.match(healthy.summary, /no confirma.*entrega/i);
  assert.match(healthy.metrics.find(item => item.key === 'accepted').label, /aceptados/i);
  for (const key of ['failed', 'uncertain', 'stale']) {
    const value = section(await fixture({ messages: { total: 1, [key]: 1 } }).health(), 'messaging');
    assert.equal(value.state, 'needs_attention', key);
    assert.equal(metrics(value)[key], 1);
  }
});

it('reports registered pass records without asserting successful issuance or installation', async () => {
  const result = await fixture({ readiness: { apple_wallet: true, google_wallet: true }, wallets: [
    { provider: 'apple', registered: 4, pending: 1, failed: 1, stale: 0, last_observed_at: now },
    { provider: 'google', registered: 5, pending: 2, failed: 0, stale: 0, last_observed_at: now }
  ] }).health();
  assert.equal(section(result, 'apple_wallet').state, 'needs_attention');
  assert.equal(section(result, 'google_wallet').state, 'configured');
  assert.equal(metrics(section(result, 'google_wallet')).registered, 5);
  assert.equal(metrics(section(result, 'google_wallet')).pending, 2);
  for (const id of ['apple_wallet', 'google_wallet']) {
    assert.match(section(result, id).summary, /no confirman.*emisión.*instalación/i);
    assert.equal(section(result, id).metrics.some(item => /emitid/i.test(item.label)), false);
  }
  const stale = await fixture({ wallets: [{ provider: 'google', registered: 1, pending: 1, stale: 1 }] }).health();
  assert.equal(section(stale, 'google_wallet').state, 'needs_attention');
});

it('uses current local readiness independently from absent, accepted or suppressed-only history', async () => {
  for (const ready of [true, false, null]) {
    for (const messages of [{}, { total: 3, accepted: 3 }, { total: 2, suppressed: 2 }]) {
      const result = await fixture({ readiness: { messaging: ready, apple_wallet: ready, google_wallet: ready }, messages,
        wallets: messages.total ? [{ provider: 'apple', registered: 3 }, { provider: 'google', registered: 4 }] : []
      }).health();
      const expected = ready === true ? 'configured' : ready === false ? 'not_configured' : 'unknown';
      for (const id of ['messaging', 'apple_wallet', 'google_wallet']) assert.equal(section(result, id).state, expected, `${id}, readiness=${ready}, history=${JSON.stringify(messages)}`);
    }
  }
});

it('treats unexpected readiness values as unknown without echoing provider configuration', async () => {
  const result = await fixture({ readiness: {
    messaging: 'private-token', apple_wallet: { ready: true, key: 'private-key' }, google_wallet: undefined,
    private_path: '/private/credential-file'
  }, messages: { total: 1, accepted: 1 }, wallets: [{ provider: 'apple', registered: 1 }] }).health();
  for (const id of ['messaging', 'apple_wallet', 'google_wallet']) assert.equal(section(result, id).state, 'unknown');
  assert.equal(JSON.stringify(result).includes('private'), false);
});

it('uses existing local readiness helpers without contacting a provider or disclosing configuration', async t => {
  const previousApple = process.env.APPLE_WALLET_ENABLED, previousGoogle = process.env.GOOGLE_WALLET_ENABLED;
  // Disabled fixture providers keep runtime initialization away from credential files.
  process.env.APPLE_WALLET_ENABLED = 'false'; process.env.GOOGLE_WALLET_ENABLED = 'false';
  const { walletSettings } = await import('../../src/app/services/native-wallet/runtime.js');
  const { config } = await import('../../src/config/index.js');
  const previous = { order: config.MESSAGE_PROVIDER_ORDER, url: config.WAHA_BASE_URL, key: config.WAHA_API_KEY,
    apple: walletSettings.apple.ready, google: walletSettings.google.ready };
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Diagnostics must not contact a provider'); });
  try {
    config.MESSAGE_PROVIDER_ORDER = ['dev']; walletSettings.apple.ready = false; walletSettings.google.ready = false;
    const service = createMerchantOperationsService({
      getBusiness: async () => ({ id: businessId, plan: 'EMPRESA' }), getFeatureOverrides: async () => ({}),
      query: async () => ({ rows: [] })
    });
    const disabled = await service.getOperationsHealth({ businessId, now });
    for (const id of ['messaging', 'apple_wallet', 'google_wallet']) assert.equal(section(disabled, id).state, 'not_configured');
    config.MESSAGE_PROVIDER_ORDER = ['waha']; config.WAHA_BASE_URL = 'https://private-provider.invalid'; config.WAHA_API_KEY = 'private-fixture-key';
    walletSettings.google.ready = true;
    const configured = await service.getOperationsHealth({ businessId, now });
    assert.equal(section(configured, 'messaging').state, 'configured');
    assert.equal(section(configured, 'apple_wallet').state, 'not_configured');
    assert.equal(section(configured, 'google_wallet').state, 'configured');
    assert.equal(JSON.stringify(configured).includes('private-'), false);
  } finally {
    config.MESSAGE_PROVIDER_ORDER = previous.order; config.WAHA_BASE_URL = previous.url; config.WAHA_API_KEY = previous.key;
    walletSettings.apple.ready = previous.apple; walletSettings.google.ready = previous.google;
    if (previousApple === undefined) delete process.env.APPLE_WALLET_ENABLED; else process.env.APPLE_WALLET_ENABLED = previousApple;
    if (previousGoogle === undefined) delete process.env.GOOGLE_WALLET_ENABLED; else process.env.GOOGLE_WALLET_ENABLED = previousGoogle;
  }
});

it('fails database errors rather than returning zero counts or unknown success', async () => {
  const error = new Error('private database detail');
  await assert.rejects(fixture({ queryError: error }).health(), error);
  await assert.rejects(fixture({ business: null }).health(), { statusCode: 404 });
});


it('reports durable pending refunds independently of a successful recent POS sync and only emits known reasons', async () => {
  const result = await fixture({ refunds: [
    { reason: 'partial_refund', pending: 2, reconciled: 0, last_observed_at: now },
    { reason: 'other', pending: 1, reconciled: 3 }
  ] }).health();
  const pos = section(result, 'pos');
  assert.equal(pos.state, 'needs_attention');
  assert.equal(metrics(pos).pending_refunds, 3);
  assert.doesNotMatch(pos.summary, /errores o ventas pendientes/);
  assert.equal(metrics(pos).reconciled_refunds, 3);
  assert.ok(pos.reasons.some(reason => reason.code === 'refund_partial_refund' && reason.count === 2));
  assert.ok(pos.reasons.some(reason => reason.code === 'refund_other' && reason.count === 1));
  assert.equal(pos.last_observed_at, now.toISOString());
  assert.equal(result.next_actions[0].id, 'pos_refunds');
  assert.equal(result.next_actions[0].href, '#conectar-caja');
});

it('combines both message queues while preserving origin, stale reasons, and acceptance semantics', async () => {
  const result = await fixture({ readiness: { messaging: true },
    messages: { total: 3, accepted: 2, processing: 1 },
    lifecycle: { total: 7, queued: 2, failed: 1, uncertain: 1, processing: 2, suppressed: 1, stale: 3, stale_queue: 1, stale_processing: 1, expired: 1, last_observed_at: now }
  }).health();
  const messaging = section(result, 'messaging');
  assert.equal(metrics(messaging).processing, 3);
  assert.equal(metrics(messaging).accepted, 2);
  assert.equal(metrics(messaging).uncertain, 1);
  assert.equal(metrics(messaging).stale, 3);
  assert.equal(messaging.sources.length, 2);
  assert.equal(metrics(messaging.sources.find(source => source.id === 'lifecycle')).processing, 2);
  for (const code of ['failed', 'uncertain', 'stale_queue', 'stale_processing', 'expired']) assert.ok(messaging.reasons.some(reason => reason.code === code), code);
  assert.match(messaging.summary, /no confirma la entrega/);
  assert.match(messaging.summary, /[Ee]n proceso.*resultado/);
  assert.ok(result.next_actions.some(action => action.id === 'lifecycle_messages' && action.href === '#automatizaciones'));
  assert.equal(result.next_actions.some(action => action.id === 'growth_messages'), false);
});

it('keeps unknown historical costs separate from missing current costs and counts real zero-cost snapshots as covered', async () => {
  const result = await fixture({ economics: { active_rewards: 3, missing_reward_costs: 1, completed_redemptions: 4, costed_redemptions: 2, missing_cost_snapshots: 1, unknown_snapshot_costs: 1 } }).health();
  const economics = section(result, 'economics');
  assert.equal(economics.state, 'needs_attention');
  assert.equal(metrics(economics).cost_coverage_pct, 50);
  assert.equal(metrics(economics).unknown_cost_redemptions, 2);
  assert.equal(metrics(economics).missing_cost_snapshots, 1);
  assert.match(economics.summary, /no cambia.*historial/);
  assert.ok(result.next_actions.some(action => action.id === 'reward_costs' && action.href === '#costos'));
  assert.ok(result.next_actions.some(action => action.id === 'historical_costs' && action.href === '#costos'));
  const empty = section(await fixture().health(), 'economics');
  assert.equal(empty.state, 'unknown');
  assert.equal(metrics(empty).cost_coverage_pct, null);
});

it('counts sections once and prioritizes attention before setup without declaring configured providers healthy', async () => {
  const result = await fixture({ readiness: { messaging: true, apple_wallet: true, google_wallet: false },
    economics: { active_rewards: 1, completed_redemptions: 2, costed_redemptions: 2 },
    messages: { total: 3, failed: 1, uncertain: 1, stale: 1 }, refunds: [{ reason: 'original_not_found', pending: 2 }]
  }).health();
  assert.deepEqual(result.summary, { attention_count: 2, setup_count: 2, configured_count: 1, healthy_count: 1, unknown_count: 0, not_in_plan_count: 0 });
  assert.ok(result.next_actions.every((action, index, actions) => !index || action.priority >= actions[index-1].priority));
  assert.ok(result.next_actions.every(action => ['pos', 'messaging', 'apple_wallet', 'google_wallet', 'economics', 'owner_brief'].includes(action.section_id)));
  assert.equal(result.next_actions.some(action => action.section_id === 'apple_wallet'), false);
  assert.equal(section(result, 'economics').state, 'healthy');
});

it('redacts all new evidence and actions when plan permissions are missing', async () => {
  const f = fixture({ business: { id: businessId, plan: 'EMPRENDEDOR', program_json: {} }, refunds: [{ reason: 'partial_refund', pending: 99 }], lifecycle: { failed: 99 }, economics: { missing_reward_costs: 99 } });
  const result = await f.health();
  assert.equal(f.calls.length, 1);
  for (const id of ['pos', 'messaging', 'economics']) {
    assert.equal(section(result, id).state, 'not_in_plan');
    assert.deepEqual(section(result, id).reasons, []);
    assert.equal(result.next_actions.some(action => action.section_id === id), false);
  }
  assert.equal(result.summary.not_in_plan_count, 4);
});

it('propagates missing-table errors instead of treating unavailable evidence as an empty or healthy queue', async () => {
  const error = Object.assign(new Error('relation unavailable'), { code: '42P01' });
  await assert.rejects(fixture({ queryError: error }).health(), { code: '42P01' });
});

it('owner brief failures are visible independently of campaign entitlement and never claim delivery',async()=>{
 const business={id:businessId,plan:'EMPRESA',program_json:{weekly_owner_brief:{channel:'email',settings:{enabled:true},owner_id:'fixture',destination:'not-exported@example.invalid'}}};
 const f=fixture({business,overrides:{EMPRESA:{campaign_rules:false}},briefs:{total:3,failed:1,uncertain:1,accepted:1,stale_processing:1,destination_ready:true},readiness:{owner_brief_email:true}});
 const result=await f.health(),brief=section(result,'owner_brief');assert.ok(brief);assert.equal(brief.state,'needs_attention');assert.equal(section(result,'messaging').state,'not_in_plan');assert.ok(result.next_actions.some(a=>a.section_id==='owner_brief'&&a.href==='#automatizaciones'));assert.match(brief.summary,/aceptación.*entrega/i);assert.ok(!JSON.stringify(result).includes('not-exported@example.invalid'));assert.equal(f.calls.filter(c=>c.sql.includes('weekly_owner_briefs')).length,1);
});
it('disabled owner brief remains opt-in and locked plans do not query its history',async()=>{
 const a=await fixture({briefs:{total:0}}).health();assert.equal(section(a,'owner_brief').state,'not_configured');
 const f=fixture({business:{id:businessId,plan:'EMPRENDEDOR',program_json:{}},overrides:{EMPRENDEDOR:{analytics:false}}});const b=await f.health();assert.equal(section(b,'owner_brief').state,'not_in_plan');assert.equal(f.calls.some(c=>c.sql.includes('weekly_owner_briefs')),false);
});
