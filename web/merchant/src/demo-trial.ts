// Synthetic, browser-only trial states for the public demo and the browser tests. The scenario
// comes from `?prueba=` on the demo URL; without it GET /api/admin/trial answers 404 like a
// server that has not deployed the feature, so the ordinary demo shows no banner.
// Extension kept: demo-api.js is also loaded by Node tests, which cannot resolve extensionless imports.
import { TRIAL_LOCK_MESSAGE } from './trial-model.ts';

export type DemoTrialScenario = 'none' | 'activa' | 'ultimos-dias' | 'bloqueada' | 'convertida';
export const DEMO_TRIAL_PARAM = 'prueba';
const SCENARIOS: readonly DemoTrialScenario[] = ['activa', 'ultimos-dias', 'bloqueada', 'convertida'];
/** Fixed clock so "days left" is stable in tests and screenshots. */
export const DEMO_TRIAL_NOW = new Date('2026-11-25T15:00:00Z');
const DAY_MS = 86_400_000;

export function demoTrialScenario(url: URL | null | undefined): DemoTrialScenario {
  const value = url?.searchParams.get(DEMO_TRIAL_PARAM) ?? '';
  return (SCENARIOS as readonly string[]).includes(value) ? (value as DemoTrialScenario) : 'none';
}

function iso(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString();
}

/** The GET /api/admin/trial body for a scenario, or null when the feature is "not deployed". */
export function demoTrialResponse(scenario: DemoTrialScenario, now: Date = DEMO_TRIAL_NOW): Record<string, unknown> | null {
  switch (scenario) {
    case 'activa':
      return {
        ok: true,
        plan: 'EMPRENDEDOR',
        plan_name: 'Conecta',
        trial: { status: 'active', started_at: iso(now, -5), ends_at: iso(now, 9), days_left: 9 },
        billing: { status: 'trialing', currency: null, provider: null, subscription: null, purge_after: null },
      };
    case 'ultimos-dias':
      return {
        ok: true,
        plan: 'EMPRENDEDOR',
        plan_name: 'Conecta',
        trial: { status: 'active', started_at: iso(now, -12), ends_at: iso(now, 2), days_left: 2 },
        billing: { status: 'trialing', currency: null, provider: null, subscription: null, purge_after: null },
      };
    case 'bloqueada':
      return {
        ok: true,
        plan: 'EMPRENDEDOR',
        plan_name: 'Conecta',
        trial: { status: 'expired', started_at: iso(now, -19), ends_at: iso(now, -5), days_left: 0 },
        billing: { status: 'locked', currency: null, provider: null, subscription: null, purge_after: iso(now, 25) },
        upgrade_url: '/negocio/#plan',
      };
    case 'convertida':
      return {
        ok: true,
        plan: 'NEGOCIO',
        plan_name: 'Impulsa',
        trial: { status: 'converted', started_at: iso(now, -40), ends_at: iso(now, -26), days_left: 0 },
        billing: { status: 'active', currency: 'GTQ', provider: 'manual', subscription: { plan: 'NEGOCIO', quantity: 1, current_period_end: iso(now, 20), cancel_at: null }, purge_after: null },
      };
    default:
      return null;
  }
}

interface ConciergeBody {
  phone?: unknown;
}

export function createTrialDemoApi(scenario: DemoTrialScenario, now: Date = DEMO_TRIAL_NOW) {
  const response = demoTrialResponse(scenario, now);
  return (url: URL, options: RequestInit = {}): unknown => {
    const method = String(options.method || 'GET').toUpperCase();
    if (url.pathname === '/api/admin/trial') {
      if (!response) throw Object.assign(new Error('No encontrado'), { status: 404 });
      return structuredClone(response);
    }
    if (url.pathname === '/api/admin/concierge-request' && method === 'POST' && response) {
      const body: ConciergeBody = typeof options.body === 'string' ? (JSON.parse(options.body) as ConciergeBody) : {};
      if (String(body.phone ?? '').trim().length < 7)
        throw Object.assign(new Error('Escribe un teléfono o WhatsApp donde podamos contactarte.'), { status: 400 });
      return { ok: true, delivered: 'demo' };
    }
    // A locked trial is read-only: every owner mutation answers like requireActiveBilling does.
    if (scenario === 'bloqueada' && method !== 'GET' && url.pathname.startsWith('/api/admin/'))
      throw Object.assign(new Error(TRIAL_LOCK_MESSAGE), { status: 402, code: 'TRIAL_LOCKED', upgrade_url: '/negocio/#plan' });
    return undefined;
  };
}

const pageScenario = typeof location !== 'undefined' ? demoTrialScenario(new URL(location.href)) : 'none';
const shared = createTrialDemoApi(pageScenario);
export function demoTrial(url: URL, options: RequestInit = {}): unknown {
  return shared(url, options);
}
