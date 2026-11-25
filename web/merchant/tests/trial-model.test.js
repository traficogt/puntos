import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENDING_SOON_DAYS,
  TRIAL_LOCK_MESSAGE,
  daysLeft,
  formatTrialDate,
  isTrialLockError,
  lockErrorUpgradeUrl,
  normalizeTrial,
  planDisplayName,
  suggestedUpgradePlan,
  trialBannerCopy,
  trialPhase,
  upgradePlanOptions,
  upgradeRequestPayload,
} from '../src/trial-model.ts';

const now = new Date('2026-11-25T15:00:00Z');
const day = (offset) => new Date(now.getTime() + offset * 86_400_000).toISOString();

test('the nested GET /api/admin/trial shape, the plan-response shape and a business row all normalise', () => {
  const nested = normalizeTrial({ ok: true, plan: 'EMPRENDEDOR', plan_name: 'Conecta', trial: { status: 'active', started_at: day(-5), ends_at: day(9), days_left: 9 }, billing: { status: 'trialing', currency: null, provider: null, subscription: null, purge_after: null } }, now);
  assert.equal(nested.trial.status, 'active');
  assert.equal(nested.trial.days_left, 9);
  assert.equal(nested.billing.status, 'trialing');
  assert.equal(nested.plan_name, 'Conecta');
  const row = normalizeTrial({ trial_status: 'expired', trial_ends_at: day(-3), billing_status: 'locked', purge_after: day(27), plan: 'EMPRENDEDOR' }, now);
  assert.equal(row.billing.status, 'locked');
  assert.equal(row.billing.purge_after, day(27));
  assert.equal(row.plan_name, 'Conecta', 'display names are derived when the server omits plan_name');
  const flat = normalizeTrial({ status: 'trialing', ends_at: day(2) }, now);
  assert.equal(flat.billing.status, 'trialing');
  assert.equal(flat.trial.status, 'active');
  assert.equal(flat.trial.days_left, 2, 'computed from ends_at when days_left is absent');
  assert.equal(normalizeTrial({ ok: true, plan: 'NEGOCIO', limits: {}, features: {} }), null, 'a legacy plan response carries no trial state');
  assert.equal(normalizeTrial(null), null);
  assert.equal(normalizeTrial('nope'), null);
  assert.equal(normalizeTrial({ trial: { status: 'weird' } }), null);
});

test('phases and banner copy follow the day-11 rule and singular/plural Spanish', () => {
  const state = (left, billing = 'trialing') => normalizeTrial({ plan: 'EMPRENDEDOR', trial: { status: 'active', ends_at: day(left), days_left: left }, billing: { status: billing } }, now);
  assert.equal(ENDING_SOON_DAYS, 4);
  assert.equal(trialPhase(state(9)), 'active');
  assert.equal(trialPhase(state(4)), 'ending');
  assert.equal(trialPhase(state(0)), 'ending');
  assert.equal(trialPhase(state(0, 'locked')), 'locked');
  assert.equal(trialPhase(normalizeTrial({ trial: { status: 'converted' }, billing: { status: 'active' } })), 'paid');
  assert.equal(trialPhase(null), 'none');
  assert.deepEqual(trialBannerCopy(state(9)), { title: 'Prueba gratis', message: 'Te quedan 9 días de prueba gratis con Conecta.', color: 'blue' });
  assert.deepEqual(trialBannerCopy(state(1)), { title: 'Prueba gratis', message: 'Te queda 1 día de prueba gratis con Conecta.', color: 'yellow' });
  assert.equal(trialBannerCopy(state(0)).message, 'Tu prueba gratis de Conecta termina hoy.');
  assert.equal(trialBannerCopy(state(0, 'locked')), null, 'the lock screen replaces the banner');
  assert.equal(trialBannerCopy(null), null);
  assert.equal(daysLeft(day(2.4), now), 3);
  assert.equal(daysLeft(day(-1), now), 0);
  assert.equal(daysLeft('garbage', now), null);
  assert.match(formatTrialDate(day(9)), /2026/);
  assert.equal(formatTrialDate(null), '');
});

test('the soft lock is recognised by status 402 or by its codes, with the upgrade url when present', () => {
  assert.equal(isTrialLockError(Object.assign(new Error('x'), { status: 402 })), true);
  assert.equal(isTrialLockError({ code: 'TRIAL_LOCKED' }), true);
  assert.equal(isTrialLockError({ code: 'TRIAL_EXPIRED', status: 403 }), true);
  assert.equal(isTrialLockError({ status: 403, code: 'PLAN_FEATURE_LOCKED' }), false);
  assert.equal(isTrialLockError(null), false);
  assert.equal(lockErrorUpgradeUrl({ upgrade_url: '/negocio/#plan' }), '/negocio/#plan');
  assert.equal(lockErrorUpgradeUrl({}), null);
  assert.equal(TRIAL_LOCK_MESSAGE, 'Tu prueba terminó. Elige un plan para seguir operando.');
});

test('plan names, suggestions and the upgrade request payload stay within the concierge schema', () => {
  assert.equal(planDisplayName('negocio'), 'Impulsa');
  assert.equal(planDisplayName('CUSTOM'), 'CUSTOM');
  assert.equal(planDisplayName(null), null);
  assert.equal(suggestedUpgradePlan('EMPRENDEDOR'), 'NEGOCIO');
  assert.equal(suggestedUpgradePlan('EMPRESA'), 'EMPRESA');
  assert.equal(suggestedUpgradePlan(null), 'NEGOCIO');
  assert.deepEqual(upgradePlanOptions().map((o) => o.label), ['Conecta · USD 39 por sucursal al mes', 'Impulsa · USD 79 por sucursal al mes', 'Expande · USD 129 por sucursal al mes']);
  const payload = upgradeRequestPayload({ plan: 'NEGOCIO', phone: ' 5555 1234 ', preferredTime: 'tardes', note: 'Dos sucursales', currentPlan: 'EMPRENDEDOR' });
  assert.equal(payload.phone, '5555 1234');
  assert.equal(payload.business_type, 'Mejorar plan');
  assert.equal(payload.preferred_time, 'tardes');
  assert.equal(payload.note, 'Plan solicitado: Impulsa (NEGOCIO) · USD 79 por sucursal al mes.\nPlan actual: Conecta.\nDos sucursales');
  const long = upgradeRequestPayload({ plan: 'EMPRESA', phone: '1'.repeat(40), preferredTime: 'x'.repeat(200), note: 'y'.repeat(2000) });
  assert.equal(long.phone.length, 25);
  assert.equal(long.preferred_time.length, 120);
  assert.equal(long.note.length, 1000);
  assert.ok(long.business_type.length <= 60);
});
